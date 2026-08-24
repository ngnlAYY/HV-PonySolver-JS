import type { InferenceHost } from '../host/inference-host'
import type { HostStatusEmitter } from '../host/status-sink'
import { addRuntimeMessageListener, runtimeGetUrl, runtimeId, sendRuntimeMessage } from '../platform/webextension'
import {
  OFFSCREEN_MESSAGE_TYPE,
  errorResponse,
  isOffscreenMessage,
  offscreenStatusMessage,
  type HostResponse,
  type HostStatusUpdate,
  type OffscreenClaimResponse,
  type OffscreenIdleConfirmationResponse,
  type OffscreenIdleMessage,
} from '../protocol/messages'

export type OffscreenInferenceHostFactory = (emitStatus: HostStatusEmitter) => InferenceHost

export const OFFSCREEN_IDLE_TIMEOUT_MS = 30_000
export const OFFSCREEN_IDLE_NOTIFICATION_RETRY_MS = 5_000
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
  let hostDestroyed = false
  const activeRequests = new Map<string, ActiveOffscreenRequest>()
  const cancelledRequestIds = new Set<string>()

  const clearIdleTimer = (): void => {
    if (idleTimeoutId !== null) {
      clearTimeout(idleTimeoutId)
      idleTimeoutId = null
    }
  }

  const sendIdleNotification = (epoch: string, generation: number): void => {
    if (currentEpoch !== epoch || idleGeneration !== generation || activeRequests.size !== 0) {
      return
    }
    const notification: OffscreenIdleMessage = {
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'idle',
      epoch,
      generation,
    }
    try {
      void Promise.resolve(sendRuntimeMessage(notification))
        .catch(() => undefined)
        .finally(() => {
          if (currentEpoch === epoch && idleGeneration === generation && activeRequests.size === 0) {
            idleTimeoutId = setTimeout(
              () => sendIdleNotification(epoch, generation),
              OFFSCREEN_IDLE_NOTIFICATION_RETRY_MS,
            )
          }
        })
    } catch {
      idleTimeoutId = setTimeout(
        () => sendIdleNotification(epoch, generation),
        OFFSCREEN_IDLE_NOTIFICATION_RETRY_MS,
      )
    }
  }

  const scheduleIdleNotification = (): void => {
    if (activeRequests.size !== 0 || currentEpoch === null) {
      return
    }
    clearIdleTimer()
    idleGeneration = null
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

  let host = hostFactory(emitStatus)

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
        for (const entry of activeRequests.values()) {
          entry.controller.abort()
        }
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
      for (const entry of activeRequests.values()) {
        if (entry.epoch !== epoch) {
          entry.controller.abort(new Error('Offscreen 推理请求所属服务工作线程已失效'))
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
    return {
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'claimed',
      epoch,
      idleGeneration,
      ...(Object.keys(latestStatus).length === 0 ? {} : { status: latestStatus }),
    }
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
      sender.url !== runtimeGetUrl('background.js') ||
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

    const kind =
      message.request.type === 'detect'
        ? 'detect'
        : message.request.type === 'prepare'
          ? 'prepare'
          : 'key'
    const atCapacity =
      (kind === 'detect' && countKind(kind) >= MAX_OFFSCREEN_DETECT_REQUESTS) ||
      (kind === 'prepare' && countKind(kind) >= MAX_OFFSCREEN_PREPARE_REQUESTS) ||
      (kind === 'key' && countKind(kind) >= MAX_OFFSCREEN_KEY_REQUESTS)
    if (atCapacity) {
      sendResponse(errorResponse(message.request.requestId, 'Offscreen 推理队列繁忙，请稍后重试'))
      return false
    }

    if (hostDestroyed) {
      host = hostFactory(emitStatus)
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
    void Promise.resolve()
      .then(() => host.handle(message.request, entry.controller.signal))
      .then((response: HostResponse) => {
        sendResponse(
          entry.controller.signal.aborted ? errorResponse(entry.hostRequestId, 'Offscreen 推理请求已取消') : response,
        )
      })
      .catch((error: unknown) => {
        const messageText = error instanceof Error ? error.message : String(error)
        sendResponse(errorResponse(entry.hostRequestId, messageText))
      })
      .finally(() => {
        if (activeRequests.get(key) === entry) {
          activeRequests.delete(key)
        }
        if (activeRequests.size === 0) {
          scheduleIdleNotification()
        }
      })
    return true
  })
}
