import {
  MODEL_ACCESS_KEY_STORAGE_KEY,
  ModelCache,
  OnnxWorkerClient,
  downloadModel,
  probeModelAccessKey,
  queryModelDownloadQuota,
  type ModelAccessKeyProbe,
} from '@hv-pony-solver/browser-core'
import { MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

import { runtimeGetUrl } from '../platform/webextension'
import { EXTENSION_PATHS } from '../platform/extension-paths'
import { IndexedDbStringStorage } from './indexeddb-string-storage'
import { InferenceHost } from './inference-host'
import { createForwardingStatusSink, silentStatusSink, type HostStatusEmitter } from './status-sink'

function assertVerificationActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('模型 Key 验证已取消')
  }
}

export type RemoteKeyVerifierDependencies = Readonly<{
  probe(signal: AbortSignal, candidateKey: string): Promise<ModelAccessKeyProbe>
  set(key: string, value: string, signal: AbortSignal): Promise<void>
}>

export function createRemoteKeyVerifier(
  dependencies: RemoteKeyVerifierDependencies,
): (candidateKey: string, signal: AbortSignal) => Promise<string | undefined> {
  return async (candidateKey, signal) => {
    const normalizedKey = candidateKey.trim()
    assertVerificationActive(signal)
    // Authenticated GET /quota settles Key validity without spending a download.
    const probe = await dependencies.probe(signal, normalizedKey)
    assertVerificationActive(signal)
    if (!probe.valid) {
      throw new Error('模型 Key 无效')
    }
    await dependencies.set(MODEL_ACCESS_KEY_STORAGE_KEY, normalizedKey, signal)
    assertVerificationActive(signal)
    // Exhaustion does not invalidate the Key. Save it and report the reset-bound
    // download restriction returned by the authenticated quota status.
    return probe.quotaExceededRetryAfterSeconds === null
      ? undefined
      : `模型 Key 有效并已安全保存；本月 ${MODEL_MONTHLY_DOWNLOAD_LIMIT} 次模型下载额度已用完，额度恢复后将自动下载模型`
  }
}

export function createRemoteInferenceHost(
  emitStatus?: HostStatusEmitter,
  emitCredentialsChanged?: () => void,
): InferenceHost {
  let closed = false
  let reconciliation: Promise<void> = Promise.resolve()
  const statusSink = emitStatus ? createForwardingStatusSink(emitStatus) : silentStatusSink
  const secretStorage = new IndexedDbStringStorage()
  // The downloader bounds its wait; pass cancellation through to the underlying Key read too.
  const getAccessKey = async (signal?: AbortSignal): Promise<string> =>
    (await secretStorage.get(MODEL_ACCESS_KEY_STORAGE_KEY, signal)) ?? ''
  const modelCache = new ModelCache(statusSink, (signal, options) => downloadModel(signal, options, { getAccessKey }))
  const detector = new OnnxWorkerClient(
    modelCache,
    statusSink,
    () => new Worker(runtimeGetUrl(EXTENSION_PATHS.inferenceWorker), { type: 'module' }),
  )
  const onCredentialsCommitted = (): void => {
    if (closed) return
    reconciliation = detector.cancelPendingPreparation().then(() => {
      if (!closed) emitCredentialsChanged?.()
    })
    void reconciliation.catch(() => undefined)
  }
  const verifyKey = createRemoteKeyVerifier({
    probe: (signal, candidateKey) => probeModelAccessKey(signal, { accessKeyOverride: candidateKey }),
    set: (key, value, signal) => secretStorage.set(key, value, signal, onCredentialsCommitted),
  })
  return new InferenceHost({
    detector,
    downloadModel: async (signal) => {
      const cached = await modelCache.getCached(signal)
      if (cached) {
        return '模型已在本地缓存'
      }
      const buffer = await modelCache.download(signal)
      await modelCache.putCached(buffer, true, true, signal)
      return '模型下载和校验成功，已缓存'
    },
    verifyKey: async (candidateKey, signal) => {
      const notice = await verifyKey(candidateKey, signal)
      await reconciliation
      return notice
    },
    clearKey: async (signal) => {
      await secretStorage.remove(MODEL_ACCESS_KEY_STORAGE_KEY, signal, onCredentialsCommitted)
      await reconciliation
    },
    queryModelQuota: async (signal) => {
      const quota = await queryModelDownloadQuota(signal, {}, { getAccessKey })
      if (!quota.enabled) {
        return '无次数限制（模型下载次数限制未开启）'
      }
      return `本月模型下载额度：已用 ${quota.used}/${quota.limit} 次，剩余 ${quota.remaining ?? 0} 次`
    },
    close: async () => {
      closed = true
      modelCache.close()
      await secretStorage.close()
    },
  })
}

export { MODEL_ACCESS_KEY_STORAGE_KEY }
