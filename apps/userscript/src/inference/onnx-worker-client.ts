import {
  OnnxWorkerClient as CoreOnnxWorkerClient,
  type InferenceStatusSink,
  type ModelRepository,
} from '@hv-pony-solver/browser-core'

import { createBlobWorker } from './blob-worker'
import { createOnnxWorkerScript } from './onnx-worker-script'

export type { ModelRepository, WorkerFactory } from '@hv-pony-solver/browser-core'

export class OnnxWorkerClient extends CoreOnnxWorkerClient {
  constructor(modelCache: ModelRepository, panel: InferenceStatusSink) {
    super(modelCache, panel, () => createBlobWorker(createOnnxWorkerScript()))
  }
}
