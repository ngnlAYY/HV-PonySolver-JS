import { registerOpenOptionsAction, sendRuntimeMessage } from '../platform/webextension'
import { OFFSCREEN_MESSAGE_TYPE, isHostResponse, type HostRequest, type HostResponse } from '../protocol/messages'
import { registerBroker, type BrokerPolicy } from './broker'
import { acquireOffscreenDocument } from './chromium-offscreen'

const serviceWorkerInstanceId = (() => {
  try {
    return globalThis.crypto.randomUUID().replaceAll('-', '')
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  }
})()
let offscreenRequestSequence = 0

function nextOffscreenRequestId(): string {
  offscreenRequestSequence += 1
  return `sw-${serviceWorkerInstanceId}-${offscreenRequestSequence.toString(36)}`.slice(0, 80)
}

function acquireForRequest(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) {
    return Promise.reject(new Error('推理请求已取消'))
  }
  const leasePromise = acquireOffscreenDocument()
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
    leasePromise.then(
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
  const release = await acquireForRequest(signal)
  let releaseWithResponse = false
  try {
    if (signal.aborted) {
      throw new Error('推理请求已取消')
    }
    const offscreenRequestId = nextOffscreenRequestId()
    let responseSettled = false
    const responsePromise = sendRuntimeMessage({
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'request',
      requestId: offscreenRequestId,
      request,
    }).finally(() => {
      responseSettled = true
    })
    try {
      const response = await waitForOffscreenResponse(responsePromise, signal, offscreenRequestId)
      if (!isHostResponse(response) || response.requestId !== request.requestId) {
        throw new Error('Offscreen 推理 Host 返回无效消息')
      }
      if (signal.aborted) {
        throw new Error('推理请求已取消')
      }
      return response
    } finally {
      if (!responseSettled) {
        releaseWithResponse = true
        void responsePromise.catch(() => undefined).finally(release)
      }
    }
  } finally {
    if (!releaseWithResponse) {
      release()
    }
  }
}

export function registerChromiumBackground(policy: BrokerPolicy = { allowOptions: true }): void {
  registerBroker(invokeOffscreenHost, policy)
  registerOpenOptionsAction()
}
