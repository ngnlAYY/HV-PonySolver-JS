import {
  MODEL_ACCESS_KEY_STORAGE_KEY,
  ModelCache,
  OnnxWorkerClient,
  downloadModel,
  getModelAccessKey,
} from '@hv-pony-solver/browser-core'

import { runtimeGetUrl } from '../platform/webextension'
import { IndexedDbStringStorage } from './indexeddb-string-storage'
import { InferenceHost } from './inference-host'
import { silentStatusSink } from './status-sink'

function assertVerificationActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('模型 Key 验证已取消')
  }
}

export type RemoteKeyVerifierDependencies = Readonly<{
  download(signal: AbortSignal, verifyIntegrity: boolean, candidateKey: string): Promise<ArrayBuffer>
  putCached(
    buffer: ArrayBuffer,
    verifyIntegrity: boolean,
    skipIntegrityVerification: boolean,
    signal: AbortSignal,
  ): Promise<void>
  prepare(signal: AbortSignal): Promise<void>
  set(key: string, value: string, signal: AbortSignal): Promise<void>
}>

export function createRemoteKeyVerifier(
  dependencies: RemoteKeyVerifierDependencies,
): (candidateKey: string, signal: AbortSignal) => Promise<void> {
  return async (candidateKey, signal) => {
    assertVerificationActive(signal)
    const modelBuffer = await dependencies.download(signal, true, candidateKey)
    assertVerificationActive(signal)
    await dependencies.putCached(modelBuffer, true, false, signal)
    assertVerificationActive(signal)
    await dependencies.prepare(signal)
    assertVerificationActive(signal)
    await dependencies.set(MODEL_ACCESS_KEY_STORAGE_KEY, candidateKey.trim(), signal)
    assertVerificationActive(signal)
  }
}

export function createRemoteInferenceHost(): InferenceHost {
  const secretStorage = new IndexedDbStringStorage()
  const modelCache = new ModelCache(
    silentStatusSink,
    (signal, options) =>
      downloadModel(signal, options, {
        getAccessKey: () => getModelAccessKey(secretStorage),
      }),
  )
  const detector = new OnnxWorkerClient(
    modelCache,
    silentStatusSink,
    () => new Worker(runtimeGetUrl('inference-worker.js'), { type: 'module' }),
  )
  return new InferenceHost({
    detector,
    verifyKey: createRemoteKeyVerifier({
      download: (signal, verifyIntegrity, candidateKey) =>
        modelCache.download(signal, verifyIntegrity, candidateKey),
      putCached: (buffer, verifyIntegrity, skipIntegrityVerification, signal) =>
        modelCache.putCached(buffer, verifyIntegrity, skipIntegrityVerification, signal),
      prepare: (signal) => detector.prepare(signal),
      set: (key, value, signal) => secretStorage.set(key, value, signal),
    }),
    close: async () => {
      modelCache.close()
      await secretStorage.close()
    },
  })
}

export { MODEL_ACCESS_KEY_STORAGE_KEY }
