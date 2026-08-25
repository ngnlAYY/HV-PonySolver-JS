import { formatErrorMessage } from '@hv-pony-solver/browser-core/utils/errors'
import { warn } from '@hv-pony-solver/browser-core/utils/logger'
import { prepareDeadlineConfig } from '@hv-pony-solver/browser-core/inference/inference-config'

import { pickForwardedHostFields } from '../host/status-fields'
import {
  addRuntimeConnectListener,
  runtimeGetUrl,
  runtimeId,
  storageSet,
  type ExtensionPort,
  type ExtensionSender,
} from '../platform/webextension'
import { MODEL_CREDENTIALS_REVISION_KEY, nextModelCredentialsRevision } from '../protocol/model-credentials-revision'
import { DETECT_DEADLINE_CONFIG } from '../protocol/deadlines'
import {
  CONTENT_PORT_NAME,
  OPTIONS_PORT_NAME,
  errorResponse,
  isCancelRequest,
  isHostRequest,
  isHostResponse,
  modelCredentialsChangedMessage,
  portStatusMessage,
  successResponse,
  type HostRequest,
  type HostResponse,
  type HostStatusUpdate,
} from '../protocol/messages'

export type HostInvoker = (request: HostRequest, signal: AbortSignal) => Promise<HostResponse>
export type BrokerPolicy = Readonly<{
  allowOptions: boolean
}>
export type BrokerHandle = Readonly<{
  dispose(): void
  broadcastContentStatus(status: HostStatusUpdate): void
}>
export const MAX_PORT_DETECT_REQUESTS = 2
export const MAX_GLOBAL_DETECT_REQUESTS = 6
export const MAX_PORT_PREPARE_REQUESTS = 2
export const MAX_GLOBAL_PREPARE_REQUESTS = 4
export const MAX_PORT_VERIFY_KEY_REQUESTS = 1
export const MAX_GLOBAL_VERIFY_KEY_REQUESTS = 2
export const MAX_PORT_DOWNLOAD_MODEL_REQUESTS = 1
export const MAX_GLOBAL_DOWNLOAD_MODEL_REQUESTS = 2
export const MAX_PORT_QUERY_MODEL_QUOTA_REQUESTS = 1
export const MAX_GLOBAL_QUERY_MODEL_QUOTA_REQUESTS = 2
export const BROKER_DETECT_TIMEOUT_MS = DETECT_DEADLINE_CONFIG.brokerTimeoutMs
export const BROKER_PREPARE_TIMEOUT_MS = prepareDeadlineConfig.brokerTimeoutMs
export const BROKER_DOWNLOAD_MODEL_TIMEOUT_MS = prepareDeadlineConfig.brokerTimeoutMs
export const BROKER_QUERY_MODEL_QUOTA_TIMEOUT_MS = prepareDeadlineConfig.brokerTimeoutMs
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
  if (request.type === 'detect') {
    return BROKER_DETECT_TIMEOUT_MS
  }
  if (request.type === 'prepare') {
    return BROKER_PREPARE_TIMEOUT_MS
  }
  if (request.type === 'download-model') {
    return BROKER_DOWNLOAD_MODEL_TIMEOUT_MS
  }
  if (request.type === 'query-model-quota') {
    return BROKER_QUERY_MODEL_QUOTA_TIMEOUT_MS
  }
  return BROKER_DEFAULT_TIMEOUT_MS
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
  let globalDownloadModelRequests = 0
  let globalQueryModelQuotaRequests = 0
  let latestHostStatus: HostStatusUpdate = {}
  const contentPorts = new Map<ExtensionPort, (message: unknown) => boolean>()

  const broadcast = (message: unknown): void => {
    for (const post of [...contentPorts.values()]) {
      post(message)
    }
  }

  const broadcastCredentialsChanged = (): void => {
    broadcast(modelCredentialsChangedMessage())
    // The broadcast only reaches Ports of this service-worker generation; the
    // persisted revision lets a later content-script generation recover too.
    void storageSet({ [MODEL_CREDENTIALS_REVISION_KEY]: nextModelCredentialsRevision() }).catch((error: unknown) => {
      warn('凭证版本持久化失败:', formatErrorMessage(error))
    })
  }

  const dispose = addRuntimeConnectListener((port) => {
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
    let portPrepareRequests = 0
    let portVerifyKeyRequests = 0
    let portDownloadModelRequests = 0
    let portQueryModelQuotaRequests = 0
    type RequestEntry = {
      readonly requestId: string
      readonly controller: AbortController
      readonly kind: 'detect' | 'prepare' | 'verify-key' | 'download-model' | 'query-model-quota' | 'other'
      released: boolean
    }
    const entries = new Map<string, RequestEntry>()
    const abortEntries = (): void => {
      for (const entry of entries.values()) {
        entry.controller.abort(new Error('推理客户端连接已断开'))
      }
    }
    const markDisconnected = (): void => {
      if (!connected) {
        return
      }
      connected = false
      contentPorts.delete(port)
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
    const post = (message: unknown): boolean => {
      if (!connected) {
        return false
      }
      try {
        port.postMessage(message)
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
      if (entries.get(entry.requestId) === entry) {
        entries.delete(entry.requestId)
      }
      if (entry.kind === 'detect') {
        portDetectRequests -= 1
        globalDetectRequests -= 1
      } else if (entry.kind === 'prepare') {
        portPrepareRequests -= 1
        globalPrepareRequests -= 1
      } else if (entry.kind === 'verify-key') {
        portVerifyKeyRequests -= 1
        globalVerifyKeyRequests -= 1
      } else if (entry.kind === 'download-model') {
        portDownloadModelRequests -= 1
        globalDownloadModelRequests -= 1
      } else if (entry.kind === 'query-model-quota') {
        portQueryModelQuotaRequests -= 1
        globalQueryModelQuotaRequests -= 1
      }
    }

    port.onDisconnect.addListener(markDisconnected)
    port.onMessage.addListener((message) => {
      if (!connected) {
        return
      }
      if (isCancelRequest(message)) {
        if (port.name !== CONTENT_PORT_NAME || entries.has(message.requestId)) {
          disconnect()
          return
        }
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
      if (
        port.name === OPTIONS_PORT_NAME &&
        message.type !== 'verify-key' &&
        message.type !== 'clear-key' &&
        message.type !== 'download-model' &&
        message.type !== 'query-model-quota'
      ) {
        disconnect()
        return
      }
      if (entries.has(message.requestId)) {
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
      if (
        message.type === 'download-model' &&
        (portDownloadModelRequests >= MAX_PORT_DOWNLOAD_MODEL_REQUESTS ||
          globalDownloadModelRequests >= MAX_GLOBAL_DOWNLOAD_MODEL_REQUESTS)
      ) {
        post(errorResponse(message.requestId, '模型下载队列繁忙，请稍后重试'))
        return
      }
      if (
        message.type === 'query-model-quota' &&
        (portQueryModelQuotaRequests >= MAX_PORT_QUERY_MODEL_QUOTA_REQUESTS ||
          globalQueryModelQuotaRequests >= MAX_GLOBAL_QUERY_MODEL_QUOTA_REQUESTS)
      ) {
        post(errorResponse(message.requestId, '模型下载次数查询队列繁忙，请稍后重试'))
        return
      }
      const kind =
        message.type === 'detect' ||
        message.type === 'prepare' ||
        message.type === 'verify-key' ||
        message.type === 'download-model' ||
        message.type === 'query-model-quota'
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
      } else if (entry.kind === 'download-model') {
        portDownloadModelRequests += 1
        globalDownloadModelRequests += 1
      } else if (entry.kind === 'query-model-quota') {
        portQueryModelQuotaRequests += 1
        globalQueryModelQuotaRequests += 1
      }
      void invokeWithTimeout(invokeHost, message, entry.controller)
        .then((response) => {
          if (!isHostResponse(response) || response.requestId !== message.requestId) {
            throw new Error('推理 Host 返回无效或错配消息')
          }
          if ((message.type === 'verify-key' || message.type === 'clear-key') && response.ok) {
            // Both credential transitions must reach content scripts live, so a
            // cleared Key exits the failure-suppression window immediately
            // instead of waiting for the persisted-revision poll.
            broadcastCredentialsChanged()
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

    if (port.name === CONTENT_PORT_NAME) {
      contentPorts.set(port, post)
      if (Object.keys(latestHostStatus).length > 0) {
        post(portStatusMessage(latestHostStatus))
      }
    }
  })

  return {
    dispose,
    broadcastContentStatus(status: HostStatusUpdate): void {
      const update = pickForwardedHostFields(status)
      if (update.model === undefined && update.session === undefined) {
        return
      }
      latestHostStatus = { ...latestHostStatus, ...update }
      broadcast(portStatusMessage(update))
    },
  }
}
