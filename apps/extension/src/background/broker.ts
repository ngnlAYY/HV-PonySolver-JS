import {
  addRuntimeConnectListener,
  runtimeGetUrl,
  runtimeId,
  type ExtensionPort,
  type ExtensionSender,
} from '../platform/webextension'
import {
  CONTENT_PORT_NAME,
  OPTIONS_PORT_NAME,
  errorResponse,
  isHostRequest,
  type HostRequest,
  type HostResponse,
} from '../protocol/messages'

export type HostInvoker = (request: HostRequest) => Promise<HostResponse>
export const MAX_PORT_DETECT_REQUESTS = 2
export const MAX_GLOBAL_DETECT_REQUESTS = 6

function senderUrl(sender: ExtensionSender | undefined): string {
  return sender?.url ?? sender?.tab?.url ?? ''
}

function isAllowedContentUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && (parsed.hostname === 'hentaiverse.org' || parsed.hostname === 'alt.hentaiverse.org')
  } catch {
    return false
  }
}

export function isTrustedPort(port: ExtensionPort, ownExtensionId: string, optionsUrl: string): boolean {
  if (port.sender?.id !== ownExtensionId) {
    return false
  }
  const url = senderUrl(port.sender)
  if (port.name === CONTENT_PORT_NAME) {
    return isAllowedContentUrl(url)
  }
  if (port.name === OPTIONS_PORT_NAME) {
    return url === optionsUrl || url.startsWith(`${optionsUrl}?`) || url.startsWith(`${optionsUrl}#`)
  }
  return false
}

export function registerBroker(invokeHost: HostInvoker): () => void {
  let globalDetectRequests = 0
  return addRuntimeConnectListener((port) => {
    if (!isTrustedPort(port, runtimeId(), runtimeGetUrl('options.html'))) {
      port.disconnect()
      return
    }
    let connected = true
    let portDetectRequests = 0
    port.onDisconnect.addListener(() => {
      connected = false
    })
    port.onMessage.addListener((message) => {
      if (!isHostRequest(message)) {
        port.disconnect()
        return
      }
      if (port.name === CONTENT_PORT_NAME && message.type === 'verify-key') {
        port.disconnect()
        return
      }
      if (port.name === OPTIONS_PORT_NAME && message.type !== 'verify-key') {
        port.disconnect()
        return
      }
      if (
        message.type === 'detect' &&
        (portDetectRequests >= MAX_PORT_DETECT_REQUESTS || globalDetectRequests >= MAX_GLOBAL_DETECT_REQUESTS)
      ) {
        port.postMessage(errorResponse(message.requestId, '推理队列繁忙，请稍后重试'))
        return
      }
      if (message.type === 'detect') {
        portDetectRequests += 1
        globalDetectRequests += 1
      }
      void invokeHost(message)
        .then((response) => {
          if (connected) {
            port.postMessage(response)
          }
        })
        .catch((error: unknown) => {
          if (connected) {
            const messageText = error instanceof Error ? error.message : String(error)
            port.postMessage(errorResponse(message.requestId, messageText))
          }
        })
        .finally(() => {
          if (message.type === 'detect') {
            portDetectRequests -= 1
            globalDetectRequests -= 1
          }
        })
    })
  })
}
