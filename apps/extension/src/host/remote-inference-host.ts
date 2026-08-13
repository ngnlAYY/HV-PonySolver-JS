import {
  MODEL_ACCESS_KEY_STORAGE_KEY,
  ModelCache,
  OnnxWorkerClient,
  downloadModel,
  getModelAccessKey,
  setModelAccessKey,
} from '@hv-pony-solver/browser-core'

import { runtimeGetUrl } from '../platform/webextension'
import { IndexedDbStringStorage } from './indexeddb-string-storage'
import { InferenceHost } from './inference-host'
import { silentStatusSink } from './status-sink'

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
    verifyKey: async (candidateKey) => {
      const modelBuffer = await modelCache.download(undefined, true, candidateKey)
      await modelCache.putCached(modelBuffer, true)
      await detector.prepare()
      await setModelAccessKey(secretStorage, candidateKey)
    },
    close: () => {
      modelCache.close()
      void secretStorage.close()
    },
  })
}

export { MODEL_ACCESS_KEY_STORAGE_KEY }
