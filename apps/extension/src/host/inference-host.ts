import {
  MODEL_ACCESS_KEY_STORAGE_KEY,
  ModelCache,
  OnnxWorkerClient,
  downloadModel,
  formatErrorMessage,
  getModelAccessKey,
  setModelAccessKey,
  type CacheStatusSink,
  type DetectorService,
  type InferenceStatusSink,
  type AsyncStringStorage,
} from '@hv-pony-solver/browser-core'

import { runtimeGetUrl } from '../platform/webextension'
import {
  decodeImage,
  errorResponse,
  successResponse,
  type HostRequest,
  type HostResponse,
} from '../protocol/messages'
import { IndexedDbStringStorage } from './indexeddb-string-storage'

type HostModelCache = Pick<ModelCache, 'download' | 'putCached' | 'close'>
type HostSecretStorage = AsyncStringStorage & Readonly<{ close(): Promise<void> }>

export type InferenceHostDependencies = Readonly<{
  detector: DetectorService
  modelCache: HostModelCache
  secretStorage: HostSecretStorage
}>

const silentStatusSink: CacheStatusSink & InferenceStatusSink = {
  setStatus: () => undefined,
  setSessionReady: () => undefined,
}

export class InferenceHost {
  constructor(private readonly dependencies: InferenceHostDependencies) {}

  async handle(request: HostRequest): Promise<HostResponse> {
    try {
      if (request.type === 'prepare') {
        await this.dependencies.detector.prepare()
        return successResponse(request.requestId)
      }
      if (request.type === 'detect') {
        const result = await this.dependencies.detector.detect(decodeImage(request))
        return successResponse(request.requestId, result)
      }
      const candidateKey = request.candidateKey.trim()
      const modelBuffer = await this.dependencies.modelCache.download(undefined, true, candidateKey)
      await this.dependencies.modelCache.putCached(modelBuffer, true)
      await this.dependencies.detector.prepare()
      await setModelAccessKey(this.dependencies.secretStorage, candidateKey)
      return successResponse(request.requestId)
    } catch (error) {
      return errorResponse(request.requestId, formatErrorMessage(error))
    }
  }

  destroy(): void {
    this.dependencies.detector.destroy()
    this.dependencies.modelCache.close()
    void this.dependencies.secretStorage.close()
  }
}

export function createInferenceHost(): InferenceHost {
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
  return new InferenceHost({ detector, modelCache, secretStorage })
}

export { MODEL_ACCESS_KEY_STORAGE_KEY }
