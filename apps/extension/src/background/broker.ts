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
  isCancelRequest,
  isHostRequest,
  isHostResponse,
  portStatusMessage,
  successResponse,
  type HostRequest,
  type HostResponse,
  type HostStatusUpdate,
} from '../protocol/messages'

export type HostInvoker = (request: HostRequest, signal: AbortSignal) => Promise<HostResponse>
export type BrokerPolicy = Readonly<{
  allowOptions: boolean
  /**
   * Called when a trusted content Port connects; the returned callback runs once
   * that Port disconnects. Lets a host keep warm resources alive for as long
   * as a captcha page is actually connected.
   */
  onContentConnected?: () => () => void
}>
export type BrokerHandle = Readonly<{
  /** Removes the runtime connect listener. */
  dispose(): void
  /** Pushes a Host stage update to every currently connected content Port. */
  broadcastContentStatus(status: HostStatusUpdate): void
}>
export const MAX_PORT_DETECT_REQUESTS = 2
export const MAX_GLOBAL_DETECT_REQUESTS = 6
export const MAX_PORT_PREPARE_REQUESTS = 2
export const MAX_GLOBAL_PREPARE_REQUESTS = 4
export const MAX_PORT_VERIFY_KEY_REQUESTS = 1
export const MAX_GLOBAL_VERIFY_KEY_REQUESTS = 2
export const BROKER_DETECT_TIMEOUT_MS = 40_000
export const BROKER_DEFAULT_TIMEOUT_MS = 105_000

function senderUrl(sender: ExtensionSender | undefined): string {
  return sender?.url ?? sender?.tab?.url ?? ''
}

function isAllowedContentUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'hentaiverse.org' || parsed.hostname === 'alt.hentaiverse.org')
    )
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

function requestTimeoutMs(request: HostRequest): number {
  return request.type === 'detect' ? BROKER_DETECT_TIMEOUT_MS : BROKER_DEFAULT_TIMEOUT_MS
}

function invokeWithTimeout(
  invokeHost: HostInvoker,
  request: HostRequest,
  controller: AbortController,
): Promise<HostResponse> {
  let hostPromise: Promise<HostResponse>
  try {
    hostPromise = Promise.resolve(invokeHost(request, controller.signal))
  } catch (error) {
    hostPromise = Promise.reject(error)
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeoutId)
      callback()
    }
    const timeoutId = setTimeout(() => {
      controller.abort(new Error('推理 Host 请求超时'))
      finish(() => reject(new Error('推理 Host 请求超时')))
    }, requestTimeoutMs(request))
    hostPromise.then(
      (response) => finish(() => resolve(response)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

export function registerBroker(invokeHost: HostInvoker, policy: BrokerPolicy = { allowOptions: true }): BrokerHandle {
  let globalDetectRequests = 0
  let globalPrepareRequests = 0
  let globalVerifyKeyRequests = 0
  const contentPorts = new Set<ExtensionPort>()
  const dispose = addRuntimeConnectListener((port) => {
    if (!isTrustedPort(port, runtimeId(), runtimeGetUrl('options.html'))) {
      port.disconnect()
      return
    }
    if (port.name === OPTIONS_PORT_NAME && !policy.allowOptions) {
      port.disconnect()
      return
    }
    if (port.name === CONTENT_PORT_NAME) {
      contentPorts.add(port)
    }
    let connected = true
    let portDetectRequests = 0
    let portPrepareRequests = 0
    let portVerifyKeyRequests = 0
    // Held for the Port's lifetime so the host can keep warm resources alive
    // while a captcha page stays connected.
    let releaseRetention: (() => void) | undefined
    if (port.name === CONTENT_PORT_NAME) {
      try {
        releaseRetention = policy.onContentConnected?.()
      } catch {
        // Retention is an optimization; a failure must not refuse the Port.
      }
    }
    type RequestEntry = {
      readonly requestId: string
      readonly controller: AbortController
      readonly kind: 'detect' | 'prepare' | 'verify-key' | 'other'
      released: boolean
    }
    const entries = new Map<string, RequestEntry>()
    const abortEntries = (): void => {
      for (const entry of entries.values()) {
        entry.controller.abort(new Error('推理客户端连接已断开'))
      }
    }
    const markDisconnected = (): void => {
      connected = false
      contentPorts.delete(port)
      abortEntries()
      const release = releaseRetention
      releaseRetention = undefined
      release?.()
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
      entries.delete(entry.requestId)
      if (entry.kind === 'detect') {
        portDetectRequests -= 1
        globalDetectRequests -= 1
      } else if (entry.kind === 'prepare') {
        portPrepareRequests -= 1
        globalPrepareRequests -= 1
      } else if (entry.kind === 'verify-key') {
        portVerifyKeyRequests -= 1
        globalVerifyKeyRequests -= 1
      }
    }
    port.onDisconnect.addListener(markDisconnected)
    port.onMessage.addListener((message) => {      if (!connected) {
        return
      }
      if (isCancelRequest(message)) {
        if (port.name !== CONTENT_PORT_NAME) {
          disconnect()
          return
        }
        // Cancelling an unknown or already-settled request is a harmless no-op,
        // so the broker always acknowledges and never disconnects for it.
        entries.get(message.cancelRequestId)?.controller.abort(new Error('推理客户端请求已取消'))
        post(successResponse(message.requestId))
        return
      }
      if (!isHostRequest(message)) {
        disconnect()
        return
      }
      if (port.name === CONTENT_PORT_NAME && message.type !== 'prepare' && message.type !== 'detect') {
        disconnect()
        return
      }
      if (port.name === OPTIONS_PORT_NAME && message.type !== 'verify-key' && message.type !== 'clear-key') {
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
      if (
        message.type === 'prepare' &&
        (portPrepareRequests >= MAX_PORT_PREPARE_REQUESTS || globalPrepareRequests >= MAX_GLOBAL_PREPARE_REQUESTS)
      ) {
        post(errorResponse(message.requestId, '推理初始化繁忙，请稍后重试'))
        return
      }
      if (
        message.type === 'verify-key' &&
        (portVerifyKeyRequests >= MAX_PORT_VERIFY_KEY_REQUESTS ||
          globalVerifyKeyRequests >= MAX_GLOBAL_VERIFY_KEY_REQUESTS)
      ) {
        post(errorResponse(message.requestId, '模型 Key 验证队列繁忙，请稍后重试'))
        return
      }
      const kind =
        message.type === 'detect' || message.type === 'prepare' || message.type === 'verify-key'
          ? message.type
          : 'other'
      const entry: RequestEntry = {
        requestId: message.requestId,
        controller: new AbortController(),
        kind,
        released: false,
      }
      entries.set(entry.requestId, entry)
      if (entry.kind === 'detect') {
        portDetectRequests += 1
        globalDetectRequests += 1
      } else if (entry.kind === 'prepare') {
        portPrepareRequests += 1
        globalPrepareRequests += 1
      } else if (entry.kind === 'verify-key') {
        portVerifyKeyRequests += 1
        globalVerifyKeyRequests += 1
      }
      void invokeWithTimeout(invokeHost, message, entry.controller)
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
  return {
    dispose,
    broadcastContentStatus(status: HostStatusUpdate): void {
      for (const port of contentPorts) {
        try {
          port.postMessage(portStatusMessage(status))
        } catch {
          // The Port is dead from the broker's point of view; drop it.
          contentPorts.delete(port)
        }
      }
    },
  }
}
