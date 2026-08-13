import { createPackagedInferenceHost } from '../host/packaged-inference-host'
import { addRuntimeMessageListener, runtimeId } from '../platform/webextension'
import { errorResponse, isOffscreenRequest } from '../protocol/messages'

const host = createPackagedInferenceHost()

addRuntimeMessageListener((message, sender, sendResponse) => {
  if (sender.id !== runtimeId() || sender.tab || !isOffscreenRequest(message)) {
    return false
  }
  void host
    .handle(message.request)
    .then(sendResponse)
    .catch((error: unknown) => {
      const messageText = error instanceof Error ? error.message : String(error)
      sendResponse(errorResponse(message.request.requestId, messageText))
    })
  return true
})

globalThis.addEventListener('pagehide', () => host.destroy(), { once: true })
