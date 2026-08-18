import type { InferenceHost } from '../host/inference-host'
import { addRuntimeMessageListener, runtimeId } from '../platform/webextension'
import { OFFSCREEN_MESSAGE_TYPE, errorResponse, isOffscreenMessage, type HostResponse } from '../protocol/messages'

export type OffscreenInferenceHostFactory = () => InferenceHost

const CANCEL_HISTORY_LIMIT = 256

type ActiveOffscreenRequest = Readonly<{
  controller: AbortController
  hostRequestId: string
}>

export function registerOffscreenHost(hostFactory: OffscreenInferenceHostFactory): void {
  const host = hostFactory()
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
  globalThis.addEventListener(
    'pagehide',
    () => {
      for (const entry of activeRequests.values()) {
        entry.controller.abort()
      }
      host.destroy()
    },
    { once: true },
  )
}
