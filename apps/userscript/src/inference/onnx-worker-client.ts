import {
  OnnxWorkerClient as CoreOnnxWorkerClient,
  type InferenceStatusSink,
  type ModelRepository,
} from '@hv-pony-solver/browser-core'

import { createBlobWorker } from './blob-worker'

export type { ModelRepository, WorkerFactory } from '@hv-pony-solver/browser-core'

declare const __HV_PONY_SOLVER_WORKER_SCRIPT__: string

export class OnnxWorkerClient extends CoreOnnxWorkerClient {
  constructor(modelCache: ModelRepository, panel: InferenceStatusSink) {
    super(modelCache, panel, () => createBlobWorker(__HV_PONY_SOLVER_WORKER_SCRIPT__))
  }
}
