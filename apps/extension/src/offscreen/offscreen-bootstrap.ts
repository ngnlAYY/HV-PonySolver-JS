import type { InferenceHost } from '../host/inference-host'
import type { HostStatusEmitter } from '../host/status-sink'
import { warn } from '@hv-pony-solver/browser-core/utils/logger'

import { addRuntimeMessageListener, runtimeGetUrl, runtimeId, sendRuntimeMessage } from '../platform/webextension'
import { EXTENSION_PATHS } from '../platform/extension-paths'
import {
  OFFSCREEN_MESSAGE_TYPE,
  errorResponse,
  isOffscreenMessage,
  modelCredentialsChangedMessage,
  offscreenStatusMessage,
  type HostResponse,
  type HostStatusUpdate,
  type OffscreenClaimResponse,
  type OffscreenIdleConfirmationResponse,
  type OffscreenIdleMessage,
} from '../protocol/messages'

export type OffscreenInferenceHostFactory = (
  emitStatus: HostStatusEmitter,
  onCredentialsCommitted: () => void,
) => InferenceHost

export const OFFSCREEN_IDLE_TIMEOUT_MS = 30_000
/** Base delay of the exponential idle-notification backoff: 5s -> 10s -> 20s -> 40s, capped. */
export const OFFSCREEN_IDLE_NOTIFICATION_RETRY_BASE_MS = 5_000
export const OFFSCREEN_IDLE_NOTIFICATION_MAX_RETRY_MS = 60_000
/**
 * Upper bound on idle notifications for one idle generation. Without it a
 * service worker that never confirms (or never manages to close this document)
 * would be woken forever on a fixed cadence.
 */
export const MAX_OFFSCREEN_IDLE_NOTIFICATIONS = 10
export const MAX_OFFSCREEN_DETECT_REQUESTS = 6
export const MAX_OFFSCREEN_PREPARE_REQUESTS = 4
export const MAX_OFFSCREEN_KEY_REQUESTS = 2

const CANCEL_HISTORY_LIMIT = 256

type ActiveOffscreenRequest = Readonly<{
  controller: AbortController
  epoch: string
  hostRequestId: string
  kind: 'detect' | 'prepare' | 'key'
}>

function requestKey(epoch: string, requestId: string): string {
  return `${epoch}:${requestId}`
}

export function registerOffscreenHost(hostFactory: OffscreenInferenceHostFactory): void {
  let currentEpoch: string | null = null
  let latestStatus: HostStatusUpdate = {}
  let lifecycleGeneration = 0
  let idleGeneration: number | null = null
  let idleTimeoutId: ReturnType<typeof setTimeout> | null = null
  let idleRetryAttempts = 0
  let hostDestroyed = false
  const activeRequests = new Map<string, ActiveOffscreenRequest>()
  const cancelledRequestIds = new Set<string>()

  const clearIdleTimer = (): void => {
    if (idleTimeoutId !== null) {
      clearTimeout(idleTimeoutId)
      idleTimeoutId = null
    }
  }

  const resetIdleRetries = (): void => {
    idleRetryAttempts = 0
  }

  function idleRetryDelayMs(attempt: number): number {
    return Math.min(
      OFFSCREEN_IDLE_NOTIFICATION_RETRY_BASE_MS * 2 ** (attempt - 1),
      OFFSCREEN_IDLE_NOTIFICATION_MAX_RETRY_MS,
    )
  }

  const sendIdleNotification = (epoch: string, generation: number): void => {
    if (currentEpoch !== epoch || idleGeneration !== generation || activeRequests.size !== 0) {
      return
    }
    if (idleRetryAttempts >= MAX_OFFSCREEN_IDLE_NOTIFICATIONS) {
      // The service worker never confirmed this generation as closed. Stop
      // waking it forever; the next request or claim restarts the heartbeat.
      warn(`Offscreen 空闲通知连续 ${MAX_OFFSCREEN_IDLE_NOTIFICATIONS} 次未完成关闭，暂停心跳`)
      return
    }
    idleRetryAttempts += 1
    const attempt = idleRetryAttempts
    const notification: OffscreenIdleMessage = {
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'idle',
      epoch,
      generation,
    }
    const scheduleRetry = (): void => {
      if (currentEpoch === epoch && idleGeneration === generation && activeRequests.size === 0) {
        idleTimeoutId = setTimeout(() => sendIdleNotification(epoch, generation), idleRetryDelayMs(attempt))
      }
    }
    try {
      void Promise.resolve(sendRuntimeMessage(notification))
        .catch(() => undefined)
        .finally(scheduleRetry)
    } catch {
      scheduleRetry()
    }
  }

  const scheduleIdleNotification = (): void => {
    if (activeRequests.size !== 0 || currentEpoch === null) {
      return
    }
    clearIdleTimer()
    idleGeneration = null
    resetIdleRetries()
    const epoch = currentEpoch
    const generation = ++lifecycleGeneration
    idleTimeoutId = setTimeout(() => {
      idleTimeoutId = null
      if (currentEpoch !== epoch || activeRequests.size !== 0 || generation !== lifecycleGeneration) {
        return
      }
      idleGeneration = generation
      sendIdleNotification(epoch, generation)
    }, OFFSCREEN_IDLE_TIMEOUT_MS)
  }

  const beginActivity = (): void => {
    clearIdleTimer()
    idleGeneration = null
    resetIdleRetries()
    lifecycleGeneration += 1
  }

  const emitStatus: HostStatusEmitter = (status) => {
    latestStatus = { ...latestStatus, ...status }
    const epoch = currentEpoch
    if (!epoch) {
      return
    }
    try {
      void Promise.resolve(sendRuntimeMessage(offscreenStatusMessage(epoch, status))).catch(() => undefined)
    } catch {
      // Status detail is best-effort and never changes inference settlement.
    }
  }

  let hostGeneration = 0
  const createHost = (): InferenceHost => {
    const generation = ++hostGeneration
    return hostFactory(emitStatus, () => {
      if (hostDestroyed || generation !== hostGeneration) return
      void sendRuntimeMessage(modelCredentialsChangedMessage()).catch(() => undefined)
    })
  }
  let host = createHost()

  const rememberCancellation = (key: string): void => {
    cancelledRequestIds.delete(key)
    cancelledRequestIds.add(key)
    while (cancelledRequestIds.size > CANCEL_HISTORY_LIMIT) {
      const oldestKey = cancelledRequestIds.values().next().value as string | undefined
      if (oldestKey === undefined) {
        break
      }
      cancelledRequestIds.delete(oldestKey)
    }
  }

  const installPageHideTeardown = (): void => {
    globalThis.addEventListener(
      'pagehide',
      () => {
        clearIdleTimer()
        idleGeneration = null
        resetIdleRetries()
        lifecycleGeneration += 1
        for (const [key, entry] of activeRequests) {
          rememberCancellation(key)
          entry.controller.abort()
        }
        // A Host is no longer allowed to consume queue capacity after document
        // teardown, even when a faulty implementation ignores its abort signal.
        activeRequests.clear()
        host.destroy()
        hostDestroyed = true
      },
      { once: true },
    )
  }
  installPageHideTeardown()

  const claimEpoch = (epoch: string): OffscreenClaimResponse => {
    if (currentEpoch !== epoch) {
      currentEpoch = epoch
      for (const [key, entry] of activeRequests) {
        if (entry.epoch !== epoch) {
          entry.controller.abort(new Error('Offscreen 推理请求所属服务工作线程已失效'))
          activeRequests.delete(key)
        }
      }
      if (activeRequests.size === 0 && idleGeneration === null) {
        // A warm-idle timer armed by the previous epoch fires as a no-op, so
        // the new owner must re-arm it — or an otherwise idle document is
        // never reclaimed. An already-idle generation is kept for the claim
        // response, which makes the claiming worker confirm and close it.
        scheduleIdleNotification()
      }
    }
    const response: OffscreenClaimResponse = {
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'claimed',
      epoch,
      idleGeneration,
    }
    if (Object.keys(latestStatus).length !== 0) {
      return { ...response, status: latestStatus }
    }
    return response
  }

  const countKind = (kind: ActiveOffscreenRequest['kind']): number => {
    let count = 0
    for (const entry of activeRequests.values()) {
      if (entry.kind === kind) {
        count += 1
      }
    }
    return count
  }

  addRuntimeMessageListener((message, sender, sendResponse) => {
    if (
      sender.id !== runtimeId() ||
      sender.tab ||
      sender.url !== runtimeGetUrl(EXTENSION_PATHS.backgroundScript) ||
      !isOffscreenMessage(message)
    ) {
      return false
    }

    if (message.operation === 'claim') {
      sendResponse(claimEpoch(message.epoch))
      return false
    }

    if (message.epoch !== currentEpoch) {
      if (message.operation === 'request') {
        sendResponse(errorResponse(message.request.requestId, 'Offscreen 推理请求所属服务工作线程已失效'))
      }
      return false
    }

    if (message.operation === 'confirm-idle') {
      if (message.epoch === currentEpoch && message.generation === idleGeneration) {
        // The worker acknowledged this idle generation (and will try to close
        // the document); a failed close restarts the backoff from the base.
        resetIdleRetries()
      }
      const response: OffscreenIdleConfirmationResponse = {
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'idle-confirmed',
        epoch: message.epoch,
        generation: message.generation,
        idle:
          activeRequests.size === 0 &&
          idleGeneration === message.generation &&
          lifecycleGeneration === message.generation,
      }
      sendResponse(response)
      return false
    }

    const key = requestKey(message.epoch, message.requestId)
    if (message.operation === 'cancel') {
      rememberCancellation(key)
      activeRequests.get(key)?.controller.abort()
      sendResponse(message)
      return false
    }
    if (cancelledRequestIds.has(key)) {
      sendResponse(errorResponse(message.request.requestId, 'Offscreen 推理请求已取消'))
      return false
    }
    if (activeRequests.has(key)) {
      sendResponse(errorResponse(message.request.requestId, 'Offscreen 推理请求 ID 重复'))
      return false
    }

    let kind: ActiveOffscreenRequest['kind']
    if (message.request.type === 'detect') {
      kind = 'detect'
    } else if (message.request.type === 'prepare') {
      kind = 'prepare'
    } else {
      kind = 'key'
    }
    const atCapacity =
      (kind === 'detect' && countKind(kind) >= MAX_OFFSCREEN_DETECT_REQUESTS) ||
      (kind === 'prepare' && countKind(kind) >= MAX_OFFSCREEN_PREPARE_REQUESTS) ||
      (kind === 'key' && countKind(kind) >= MAX_OFFSCREEN_KEY_REQUESTS)
    if (atCapacity) {
      sendResponse(errorResponse(message.request.requestId, 'Offscreen 推理队列繁忙，请稍后重试'))
      return false
    }

    if (hostDestroyed) {
      host = createHost()
      hostDestroyed = false
      installPageHideTeardown()
    }

    beginActivity()
    const entry: ActiveOffscreenRequest = {
      controller: new AbortController(),
      epoch: message.epoch,
      hostRequestId: message.request.requestId,
      kind,
    }
    activeRequests.set(key, entry)
    const sendHostResponse = (response: HostResponse): void => {
      try {
        sendResponse(response)
      } catch {
        // The runtime channel may close while Host work is settling.
      }
    }
    void Promise.resolve()
      .then(() => host.handle(message.request, entry.controller.signal))
      .then(
        (response: HostResponse) => {
          sendHostResponse(
            entry.controller.signal.aborted ? errorResponse(entry.hostRequestId, 'Offscreen 推理请求已取消') : response,
          )
        },
        (error: unknown) => {
          const messageText = error instanceof Error ? error.message : String(error)
          sendHostResponse(
            errorResponse(
              entry.hostRequestId,
              entry.controller.signal.aborted ? 'Offscreen 推理请求已取消' : messageText,
            ),
          )
        },
      )
      .finally(() => {
        if (activeRequests.get(key) !== entry) return
        activeRequests.delete(key)
        if (activeRequests.size === 0) {
          scheduleIdleNotification()
        }
      })
    return true
  })
}
