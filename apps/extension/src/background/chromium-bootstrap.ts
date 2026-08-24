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
} from './chromium-offscreen'

const serviceWorkerEpoch = (() => {
  try {
    return globalThis.crypto.randomUUID().replaceAll('-', '')
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  }
})()
let offscreenRequestSequence = 0

function nextOffscreenRequestId(): string {
  offscreenRequestSequence += 1
  return `sw-${serviceWorkerEpoch}-${offscreenRequestSequence.toString(36)}`.slice(0, 80)
}

async function claimOffscreenHost(): Promise<OffscreenClaimResponse> {
  const response = await sendRuntimeMessage({
    type: OFFSCREEN_MESSAGE_TYPE,
    operation: 'claim',
    epoch: serviceWorkerEpoch,
  })
  if (!isOffscreenClaimResponse(response) || response.epoch !== serviceWorkerEpoch) {
    throw new Error('Offscreen 推理 Host 接管失败')
  }
  return response
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
    await claimOffscreenHost()
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

function registerOffscreenRelay(broadcast: (status: HostStatusUpdate) => void): void {
  addRuntimeMessageListener((message, sender) => {
    if (!isTrustedOffscreenSender(sender)) {
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
    .catch(() => undefined)
}

export function registerChromiumBackground(policy: BrokerPolicy = { allowOptions: true }): void {
  const handle: BrokerHandle | undefined = registerBroker(invokeOffscreenHost, policy)
  const broadcast = (status: HostStatusUpdate): void => handle?.broadcastContentStatus(status)
  registerOffscreenRelay(broadcast)
  claimExistingOffscreen(broadcast)
  registerOpenOptionsAction()
}
