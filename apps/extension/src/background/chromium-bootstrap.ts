import { formatErrorMessage } from '@hv-pony-solver/browser-core/utils/errors'
import { warn } from '@hv-pony-solver/browser-core/utils/logger'
import { raceAbort } from '@hv-pony-solver/browser-core/utils/abort-race'

import {
  addRuntimeMessageListener,
  registerOpenOptionsAction,
  runtimeGetUrl,
  runtimeId,
  sendRuntimeMessage,
} from '../platform/webextension'
import {
  OFFSCREEN_MESSAGE_TYPE,
  isHostResponse,
  isModelCredentialsChangedMessage,
  isOffscreenClaimResponse,
  isOffscreenIdleConfirmationResponse,
  isOffscreenIdleMessage,
  isOffscreenStatusMessage,
  type HostRequest,
  type HostResponse,
  type HostStatusUpdate,
  type OffscreenClaimResponse,
} from '../protocol/messages'
import { registerBroker, type BrokerHandle, type BrokerPolicy } from './broker'
import {
  acquireOffscreenAdmission,
  closeOffscreenDocumentIfIdle,
  hasOffscreenDocument,
  offscreenDocumentIdentity,
} from './chromium-offscreen'
import { OFFSCREEN_CLAIM_TIMEOUT_MS } from '../protocol/deadlines'

const serviceWorkerEpoch = (() => {
  try {
    return globalThis.crypto.randomUUID().replaceAll('-', '')
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  }
})()
let offscreenRequestSequence = 0
let claimedHost: Readonly<{ contextId: string; promise: Promise<OffscreenClaimResponse> }> | null = null

function nextOffscreenRequestId(): string {
  offscreenRequestSequence += 1
  return `sw-${serviceWorkerEpoch}-${offscreenRequestSequence.toString(36)}`.slice(0, 80)
}

async function claimOffscreenHost(signal?: AbortSignal): Promise<OffscreenClaimResponse> {
  const contextId = offscreenDocumentIdentity()
  let promise = contextId !== null && claimedHost?.contextId === contextId ? claimedHost.promise : undefined
  if (!promise) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Offscreen 推理 Host 接管超时')), OFFSCREEN_CLAIM_TIMEOUT_MS)
    })
    promise = Promise.race([
      sendRuntimeMessage({ type: OFFSCREEN_MESSAGE_TYPE, operation: 'claim', epoch: serviceWorkerEpoch }),
      expired,
    ])
      .then((response) => {
        if (!isOffscreenClaimResponse(response) || response.epoch !== serviceWorkerEpoch)
          throw new Error('Offscreen 推理 Host 接管失败')
        return response
      })
      .finally(() => clearTimeout(timeout))
    const attempt = promise
    // 首次创建后尚不知道 contextId 时不缓存；下一次 getContexts 会给出真实身份。
    claimedHost = contextId === null ? null : { contextId, promise }
    void promise.catch(() => {
      if (claimedHost?.promise === attempt) claimedHost = null
    })
  }
  return raceAbort(promise, signal, () => new Error('推理请求已取消'))
}

function acquireForRequest(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) {
    return Promise.reject(new Error('推理请求已取消'))
  }
  const admissionPromise = acquireOffscreenAdmission()
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    const finish = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      callback()
    }
    const onAbort = (): void => finish(() => reject(new Error('推理请求已取消')))
    signal.addEventListener('abort', onAbort, { once: true })
    admissionPromise.then(
      (release) => {
        if (settled) {
          release()
          return
        }
        finish(() => resolve(release))
      },
      (error: unknown) => finish(() => reject(error)),
    )
    if (signal.aborted) {
      onAbort()
    }
  })
}

function waitForOffscreenResponse(
  responsePromise: Promise<unknown>,
  signal: AbortSignal,
  offscreenRequestId: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    const finish = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      callback()
    }
    const onAbort = (): void => {
      if (settled) {
        return
      }
      void sendRuntimeMessage({
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'cancel',
        epoch: serviceWorkerEpoch,
        requestId: offscreenRequestId,
      }).catch(() => undefined)
      finish(() => reject(new Error('推理请求已取消')))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    responsePromise.then(
      (response) => finish(() => resolve(response)),
      (error: unknown) => finish(() => reject(error)),
    )
    if (signal.aborted) {
      onAbort()
    }
  })
}

export async function invokeOffscreenHost(request: HostRequest, signal: AbortSignal): Promise<HostResponse> {
  const releaseAdmission = await acquireForRequest(signal)
  let admissionReleased = false
  const release = (): void => {
    if (admissionReleased) {
      return
    }
    admissionReleased = true
    releaseAdmission()
  }
  try {
    if (signal.aborted) {
      throw new Error('推理请求已取消')
    }
    await claimOffscreenHost(signal)
    if (signal.aborted) {
      throw new Error('推理请求已取消')
    }
    const offscreenRequestId = nextOffscreenRequestId()
    const responsePromise = sendRuntimeMessage({
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'request',
      epoch: serviceWorkerEpoch,
      requestId: offscreenRequestId,
      request,
    })
    release()
    const response = await waitForOffscreenResponse(responsePromise, signal, offscreenRequestId)
    if (!isHostResponse(response) || response.requestId !== request.requestId) {
      throw new Error('Offscreen 推理 Host 返回无效消息')
    }
    if (signal.aborted) {
      throw new Error('推理请求已取消')
    }
    return response
  } catch (error) {
    if (!signal.aborted) claimedHost = null
    throw error
  } finally {
    release()
  }
}

function isTrustedOffscreenSender(sender: Readonly<{ id?: string; url?: string; tab?: unknown }>): boolean {
  return sender.id === runtimeId() && !sender.tab && sender.url === runtimeGetUrl('offscreen.html')
}

async function confirmAndCloseIdleGeneration(generation: number): Promise<void> {
  await closeOffscreenDocumentIfIdle(async () => {
    await claimOffscreenHost()
    const response = await sendRuntimeMessage({
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'confirm-idle',
      epoch: serviceWorkerEpoch,
      generation,
    })
    return (
      isOffscreenIdleConfirmationResponse(response) &&
      response.epoch === serviceWorkerEpoch &&
      response.generation === generation &&
      response.idle
    )
  })
}

function registerOffscreenRelay(broadcast: (status: HostStatusUpdate) => void, credentialsChanged: () => void): void {
  addRuntimeMessageListener((message, sender) => {
    if (!isTrustedOffscreenSender(sender)) {
      return false
    }
    if (isModelCredentialsChangedMessage(message)) {
      credentialsChanged()
      return false
    }
    if (isOffscreenStatusMessage(message) && message.epoch === serviceWorkerEpoch) {
      broadcast(message.status)
      return false
    }
    if (isOffscreenIdleMessage(message)) {
      void confirmAndCloseIdleGeneration(message.generation)
    }
    return false
  })
}

function claimExistingOffscreen(broadcast: (status: HostStatusUpdate) => void): void {
  void hasOffscreenDocument()
    .then(async (exists) => {
      if (!exists) {
        return
      }
      const claim = await claimOffscreenHost()
      if (claim.status) {
        broadcast(claim.status)
      }
      if (claim.idleGeneration !== null) {
        await confirmAndCloseIdleGeneration(claim.idleGeneration)
      }
    })
    .catch((error: unknown) => {
      // Startup-only best-effort reclaim: a surviving document still recovers
      // through the per-request claim path, but silence hid real breakage.
      warn('接管既有 Offscreen 推理文档失败:', formatErrorMessage(error))
    })
}

export function registerChromiumBackground(policy: BrokerPolicy = { allowOptions: true }): void {
  const handle: BrokerHandle | undefined = registerBroker(invokeOffscreenHost, policy)
  const broadcast = (status: HostStatusUpdate): void => handle?.broadcastContentStatus(status)
  registerOffscreenRelay(broadcast, () => handle?.broadcastCredentialsChanged())
  claimExistingOffscreen(broadcast)
  registerOpenOptionsAction()
}
