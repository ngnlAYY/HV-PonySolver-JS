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
  isHostResponse,
  type HostRequest,
  type HostResponse,
} from '../protocol/messages'

export type HostInvoker = (request: HostRequest, signal: AbortSignal) => Promise<HostResponse>
export type BrokerPolicy = Readonly<{ allowOptions: boolean }>
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

export function registerBroker(invokeHost: HostInvoker, policy: BrokerPolicy = { allowOptions: true }): () => void {
  let globalDetectRequests = 0
  return addRuntimeConnectListener((port) => {
    if (!isTrustedPort(port, runtimeId(), runtimeGetUrl('options.html'))) {
      port.disconnect()
      return
    }
    if (port.name === OPTIONS_PORT_NAME && !policy.allowOptions) {
      port.disconnect()
      return
    }
    let connected = true
    let portDetectRequests = 0
    type RequestEntry = {
      readonly controller: AbortController
      readonly detect: boolean
      released: boolean
    }
    const entries = new Set<RequestEntry>()
    const abortEntries = (): void => {
      for (const entry of entries) {
        entry.controller.abort()
      }
    }
    const markDisconnected = (): void => {
      connected = false
      abortEntries()
    }
    const disconnect = (): void => {
      if (!connected) {
        return
      }
      markDisconnected()
      try {
        port.disconnect()
      } catch {
        // The Port is already considered closed locally.
      }
    }
    const post = (response: HostResponse): boolean => {
      if (!connected) {
        return false
      }
      try {
        port.postMessage(response)
        return true
      } catch {
        disconnect()
        return false
      }
    }
    const release = (entry: RequestEntry): void => {
      if (entry.released) {
        return
      }
      entry.released = true
      entries.delete(entry)
      if (entry.detect) {
        portDetectRequests -= 1
        globalDetectRequests -= 1
      }
    }
    port.onDisconnect.addListener(markDisconnected)
    port.onMessage.addListener((message) => {
      if (!connected) {
        return
      }
      if (!isHostRequest(message)) {
        disconnect()
        return
      }
      if (port.name === CONTENT_PORT_NAME && message.type === 'verify-key') {
        disconnect()
        return
      }
      if (port.name === OPTIONS_PORT_NAME && message.type !== 'verify-key') {
        disconnect()
        return
      }
      if (
        message.type === 'detect' &&
        (portDetectRequests >= MAX_PORT_DETECT_REQUESTS || globalDetectRequests >= MAX_GLOBAL_DETECT_REQUESTS)
      ) {
        post(errorResponse(message.requestId, '推理队列繁忙，请稍后重试'))
        return
      }
      const entry: RequestEntry = {
        controller: new AbortController(),
        detect: message.type === 'detect',
        released: false,
      }
      entries.add(entry)
      if (entry.detect) {
        portDetectRequests += 1
        globalDetectRequests += 1
      }
      let hostPromise: Promise<HostResponse>
      try {
        hostPromise = invokeHost(message, entry.controller.signal)
      } catch (error) {
        hostPromise = Promise.reject(error)
      }
      void hostPromise
        .then((response) => {
          if (!isHostResponse(response) || response.requestId !== message.requestId) {
            throw new Error('推理 Host 返回无效或错配消息')
          }
          post(response)
        })
        .catch((error: unknown) => {
          if (connected) {
            const messageText = error instanceof Error ? error.message : String(error)
            post(errorResponse(message.requestId, messageText))
          }
        })
        .finally(() => {
          release(entry)
        })
    })
  })
}
