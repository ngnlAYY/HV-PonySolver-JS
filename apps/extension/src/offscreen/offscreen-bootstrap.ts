import type { InferenceHost } from '../host/inference-host'
import type { HostStatusEmitter } from '../host/status-sink'
import { addRuntimeMessageListener, runtimeId, sendRuntimeMessage } from '../platform/webextension'
import {
  OFFSCREEN_MESSAGE_TYPE,
  errorResponse,
  isOffscreenMessage,
  offscreenStatusMessage,
  type HostResponse,
} from '../protocol/messages'

export type OffscreenInferenceHostFactory = (emitStatus: HostStatusEmitter) => InferenceHost

const CANCEL_HISTORY_LIMIT = 256

type ActiveOffscreenRequest = Readonly<{
  controller: AbortController
  hostRequestId: string
}>

export function registerOffscreenHost(hostFactory: OffscreenInferenceHostFactory): void {
  // Stage updates travel to the service worker, which relays them to content
  // Ports. Delivery is best-effort and must never disturb inference: wrap the
  // send so both sync throws and rejected promises are swallowed.
  const emitStatus: HostStatusEmitter = (status) => {
    try {
      void Promise.resolve(sendRuntimeMessage(offscreenStatusMessage(status))).catch(() => undefined)
    } catch {
      // See above.
    }
  }
  let host = hostFactory(emitStatus)
  // A pagehide does not always mean this document is about to go away. The
  // next accepted request proves the document is still serving, so the Host is
  // rebuilt then instead of failing every future request terminally.
  let hostDestroyed = false
  const activeRequests = new Map<string, ActiveOffscreenRequest>()
  const cancelledRequestIds = new Set<string>()
  const rememberCancellation = (requestId: string): void => {
    cancelledRequestIds.delete(requestId)
    cancelledRequestIds.add(requestId)
    while (cancelledRequestIds.size > CANCEL_HISTORY_LIMIT) {
      const oldestRequestId = cancelledRequestIds.values().next().value as string | undefined
      if (oldestRequestId === undefined) {
        break
      }
      cancelledRequestIds.delete(oldestRequestId)
    }
  }

  const installPageHideTeardown = (): void => {
    globalThis.addEventListener(
      'pagehide',
      () => {
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

  addRuntimeMessageListener((message, sender, sendResponse) => {
    if (sender.id !== runtimeId() || sender.tab || !isOffscreenMessage(message)) {
      return false
    }
    if (message.operation === 'cancel') {
      rememberCancellation(message.requestId)
      activeRequests.get(message.requestId)?.controller.abort()
      sendResponse({
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'cancel',
        requestId: message.requestId,
      })
      return false
    }
    if (cancelledRequestIds.has(message.requestId)) {
      sendResponse(errorResponse(message.request.requestId, 'Offscreen 推理请求已取消'))
      return false
    }
    if (activeRequests.has(message.requestId)) {
      sendResponse(errorResponse(message.request.requestId, 'Offscreen 推理请求 ID 重复'))
      return false
    }

    if (hostDestroyed) {
      host = hostFactory(emitStatus)
      hostDestroyed = false
      installPageHideTeardown()
    }

    const entry: ActiveOffscreenRequest = {
      controller: new AbortController(),
      hostRequestId: message.request.requestId,
    }
    activeRequests.set(message.requestId, entry)
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
        if (activeRequests.get(message.requestId) === entry) {
          activeRequests.delete(message.requestId)
        }
      })
    return true
  })
}
