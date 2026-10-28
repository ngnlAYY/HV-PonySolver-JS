import { formatErrorMessage } from '@hv-pony-solver/browser-core/utils/errors'
import { warn } from '@hv-pony-solver/browser-core/utils/logger'
import { prepareDeadlineConfig } from '@hv-pony-solver/browser-core/inference/inference-config'

import { pickForwardedHostFields } from '../host/status-fields'
import { EXTENSION_PATHS } from '../platform/extension-paths'
import {
  addRuntimeConnectListener,
  readPortDisconnectError,
  runtimeGetUrl,
  runtimeId,
  storageSet,
  type ExtensionPort,
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
  broadcastCredentialsChanged(): void
  broadcastContentStatus(status: HostStatusUpdate): void
}>
export const MAX_PORT_DETECT_REQUESTS = 2
export const MAX_GLOBAL_DETECT_REQUESTS = 6
export const MAX_PORT_PREPARE_REQUESTS = 2
export const MAX_GLOBAL_PREPARE_REQUESTS = 4
export const MAX_PORT_VERIFY_KEY_REQUESTS = 1
export const MAX_GLOBAL_VERIFY_KEY_REQUESTS = 2
export const MAX_PORT_CLEAR_KEY_REQUESTS = 1
export const MAX_GLOBAL_CLEAR_KEY_REQUESTS = 2
export const MAX_PORT_DOWNLOAD_MODEL_REQUESTS = 1
export const MAX_GLOBAL_DOWNLOAD_MODEL_REQUESTS = 2
export const MAX_PORT_QUERY_MODEL_QUOTA_REQUESTS = 1
export const MAX_GLOBAL_QUERY_MODEL_QUOTA_REQUESTS = 2
export const BROKER_DETECT_TIMEOUT_MS = DETECT_DEADLINE_CONFIG.brokerTimeoutMs
export const BROKER_PREPARE_TIMEOUT_MS = prepareDeadlineConfig.brokerTimeoutMs
export const BROKER_DOWNLOAD_MODEL_TIMEOUT_MS = prepareDeadlineConfig.brokerTimeoutMs
export const BROKER_QUERY_MODEL_QUOTA_TIMEOUT_MS = prepareDeadlineConfig.brokerTimeoutMs
export const BROKER_DEFAULT_TIMEOUT_MS = 105_000

export function isTrustedPort(port: ExtensionPort, ownExtensionId: string, optionsUrl: string): boolean {
  const sender = port.sender
  if (sender?.id !== ownExtensionId || !sender.url || (sender.frameId !== undefined && sender.frameId !== 0)) {
    return false
  }
  // tab.url 属于顶层标签页，不能替代实际发送 frame 的 URL；本产品不注入子 frame。
  const url = sender.url
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) return false
    // 非浏览器 URL 实现可能把扩展 scheme 的 origin 序列化为 null，按 scheme/host 比较。
    const origin = `${parsed.protocol}//${parsed.host}`
    if (sender.origin !== undefined && sender.origin !== origin) return false
    if (port.name === CONTENT_PORT_NAME) {
      return parsed.origin === 'https://hentaiverse.org' || parsed.origin === 'https://alt.hentaiverse.org'
    }
    if (port.name === OPTIONS_PORT_NAME) {
      return url === optionsUrl || url.startsWith(`${optionsUrl}?`) || url.startsWith(`${optionsUrl}#`)
    }
  } catch {
    return false
  }
  return false
}

type RequestKind = HostRequest['type']
type RequestPolicy = Readonly<{
  portLimit: number
  globalLimit: number
  timeoutMs: number
  busyMessage: string
}>

const REQUEST_POLICIES: Readonly<Record<RequestKind, RequestPolicy>> = {
  detect: {
    portLimit: MAX_PORT_DETECT_REQUESTS,
    globalLimit: MAX_GLOBAL_DETECT_REQUESTS,
    timeoutMs: BROKER_DETECT_TIMEOUT_MS,
    busyMessage: '推理队列繁忙，请稍后重试',
  },
  prepare: {
    portLimit: MAX_PORT_PREPARE_REQUESTS,
    globalLimit: MAX_GLOBAL_PREPARE_REQUESTS,
    timeoutMs: BROKER_PREPARE_TIMEOUT_MS,
    busyMessage: '推理初始化繁忙，请稍后重试',
  },
  'verify-key': {
    portLimit: MAX_PORT_VERIFY_KEY_REQUESTS,
    globalLimit: MAX_GLOBAL_VERIFY_KEY_REQUESTS,
    timeoutMs: BROKER_DEFAULT_TIMEOUT_MS,
    busyMessage: '模型 Key 验证队列繁忙，请稍后重试',
  },
  'clear-key': {
    portLimit: MAX_PORT_CLEAR_KEY_REQUESTS,
    globalLimit: MAX_GLOBAL_CLEAR_KEY_REQUESTS,
    timeoutMs: BROKER_DEFAULT_TIMEOUT_MS,
    busyMessage: '模型 Key 清除队列繁忙，请稍后重试',
  },
  'download-model': {
    portLimit: MAX_PORT_DOWNLOAD_MODEL_REQUESTS,
    globalLimit: MAX_GLOBAL_DOWNLOAD_MODEL_REQUESTS,
    timeoutMs: BROKER_DOWNLOAD_MODEL_TIMEOUT_MS,
    busyMessage: '模型下载队列繁忙，请稍后重试',
  },
  'query-model-quota': {
    portLimit: MAX_PORT_QUERY_MODEL_QUOTA_REQUESTS,
    globalLimit: MAX_GLOBAL_QUERY_MODEL_QUOTA_REQUESTS,
    timeoutMs: BROKER_QUERY_MODEL_QUOTA_TIMEOUT_MS,
    busyMessage: '模型下载次数查询队列繁忙，请稍后重试',
  },
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
    }, REQUEST_POLICIES[request.type].timeoutMs)
    hostPromise.then(
      (response) => finish(() => resolve(response)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

export function registerBroker(invokeHost: HostInvoker, policy: BrokerPolicy = { allowOptions: true }): BrokerHandle {
  const globalRequests = new Map<RequestKind, number>()
  let latestHostStatus: HostStatusUpdate = {}
  let pendingCredentialsRevision: string | null = null
  let credentialsRevisionWriteRunning = false
  const contentPorts = new Map<ExtensionPort, (message: unknown) => boolean>()

  const broadcast = (message: unknown): void => {
    for (const post of [...contentPorts.values()]) {
      post(message)
    }
  }

  const drainCredentialsRevisionWrites = async (): Promise<void> => {
    if (credentialsRevisionWriteRunning) {
      return
    }
    credentialsRevisionWriteRunning = true
    try {
      while (pendingCredentialsRevision !== null) {
        const revision = pendingCredentialsRevision
        pendingCredentialsRevision = null
        try {
          await storageSet({ [MODEL_CREDENTIALS_REVISION_KEY]: revision })
        } catch (error) {
          warn('凭证版本持久化失败:', formatErrorMessage(error))
        }
      }
    } finally {
      credentialsRevisionWriteRunning = false
      if (pendingCredentialsRevision !== null) {
        void drainCredentialsRevisionWrites()
      }
    }
  }

  const persistCredentialsRevision = (revision: string): void => {
    // One in-flight write plus the newest pending revision is sufficient. This
    // preserves ordering without growing an unbounded promise chain if storage
    // stalls while the user verifies or clears a Key repeatedly.
    pendingCredentialsRevision = revision
    void drainCredentialsRevisionWrites()
  }

  const broadcastCredentialsChanged = (): void => {
    broadcast(modelCredentialsChangedMessage())
    // The broadcast only reaches Ports of this service-worker generation; the
    // persisted revision lets a later content-script generation recover too.
    persistCredentialsRevision(nextModelCredentialsRevision())
  }

  const dispose = addRuntimeConnectListener((port) => {
    if (!isTrustedPort(port, runtimeId(), runtimeGetUrl(EXTENSION_PATHS.optionsPage))) {
      port.disconnect()
      return
    }
    if (port.name === OPTIONS_PORT_NAME && !policy.allowOptions) {
      port.disconnect()
      return
    }

    let connected = true
    const portRequests = new Map<RequestKind, number>()
    type RequestEntry = {
      readonly requestId: string
      readonly controller: AbortController
      readonly kind: HostRequest['type']
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
      portRequests.set(entry.kind, (portRequests.get(entry.kind) ?? 0) - 1)
      globalRequests.set(entry.kind, (globalRequests.get(entry.kind) ?? 0) - 1)
    }

    port.onDisconnect.addListener(() => {
      // BFCache 等页面离开也会携带 lastError；先读取，再按断连取消所有未决请求。
      readPortDisconnectError(port)
      markDisconnected()
    })
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
      const { portLimit, globalLimit, busyMessage } = REQUEST_POLICIES[message.type]
      if (
        (portRequests.get(message.type) ?? 0) >= portLimit ||
        (globalRequests.get(message.type) ?? 0) >= globalLimit
      ) {
        post(errorResponse(message.requestId, busyMessage))
        return
      }
      const entry: RequestEntry = {
        requestId: message.requestId,
        controller: new AbortController(),
        kind: message.type,
        released: false,
      }
      entries.set(entry.requestId, entry)
      portRequests.set(entry.kind, (portRequests.get(entry.kind) ?? 0) + 1)
      globalRequests.set(entry.kind, (globalRequests.get(entry.kind) ?? 0) + 1)
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

    if (port.name === CONTENT_PORT_NAME) {
      contentPorts.set(port, post)
      if (Object.keys(latestHostStatus).length > 0) {
        post(portStatusMessage(latestHostStatus))
      }
    }
  })

  return {
    dispose,
    broadcastCredentialsChanged,
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
