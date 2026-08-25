import {
  MODEL_ACCESS_KEY_STORAGE_KEY,
  ModelCache,
  OnnxWorkerClient,
  downloadModel,
  getModelAccessKey,
  probeModelAccessKey,
  queryModelDownloadQuota,
  type ModelAccessKeyProbe,
} from '@hv-pony-solver/browser-core'
import { MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

import { runtimeGetUrl } from '../platform/webextension'
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
    // A HEAD probe settles Key validity without spending a monthly download.
    const probe = await dependencies.probe(signal, normalizedKey)
    assertVerificationActive(signal)
    if (!probe.valid) {
      throw new Error('模型 Key 无效')
    }
    await dependencies.set(MODEL_ACCESS_KEY_STORAGE_KEY, normalizedKey, signal)
    assertVerificationActive(signal)
    // Defensive: HEAD is unmetered today, so the probe cannot observe an
    // exhausted quota. If it ever does, keep the Key and say so — an exhausted
    // quota proves the Key is valid, and the download retries once it resets.
    return probe.quotaExceededRetryAfterSeconds === null
      ? undefined
      : `模型 Key 有效并已安全保存；本月 ${MODEL_MONTHLY_DOWNLOAD_LIMIT} 次模型下载额度已用完，额度恢复后将自动下载模型`
  }
}

export function createRemoteInferenceHost(emitStatus?: HostStatusEmitter): InferenceHost {
  const statusSink = emitStatus ? createForwardingStatusSink(emitStatus) : silentStatusSink
  const secretStorage = new IndexedDbStringStorage()
  const modelCache = new ModelCache(statusSink, (signal, options) =>
    downloadModel(signal, options, {
      getAccessKey: () => getModelAccessKey(secretStorage),
    }),
  )
  const detector = new OnnxWorkerClient(
    modelCache,
    statusSink,
    () => new Worker(runtimeGetUrl('inference-worker.js'), { type: 'module' }),
  )
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
    verifyKey: createRemoteKeyVerifier({
      probe: (signal, candidateKey) => probeModelAccessKey(signal, { accessKeyOverride: candidateKey }),
      set: (key, value, signal) => secretStorage.set(key, value, signal),
    }),
    clearKey: (signal) => secretStorage.remove(MODEL_ACCESS_KEY_STORAGE_KEY, signal),
    queryModelQuota: async (signal) => {
      const quota = await queryModelDownloadQuota(signal, {}, { getAccessKey: () => getModelAccessKey(secretStorage) })
      if (!quota.enabled) {
        return '无次数限制（模型下载次数限制未开启）'
      }
      return `本月模型下载额度：已用 ${quota.used}/${quota.limit} 次，剩余 ${quota.remaining ?? 0} 次`
    },
    close: async () => {
      modelCache.close()
      await secretStorage.close()
    },
  })
}

export { MODEL_ACCESS_KEY_STORAGE_KEY }
