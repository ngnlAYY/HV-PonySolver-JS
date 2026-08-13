import { OnnxWorkerClient } from '@hv-pony-solver/browser-core/inference/onnx-worker-client'

import { runtimeGetUrl } from '../platform/webextension'
import { InferenceHost } from './inference-host'
import { PackagedModelRepository } from './packaged-model-repository'
import { silentStatusSink } from './status-sink'

export function createPackagedInferenceHost(): InferenceHost {
  const detector = new OnnxWorkerClient(
    new PackagedModelRepository(),
    silentStatusSink,
    () => new Worker(runtimeGetUrl('inference-worker.js'), { type: 'module' }),
  )
  return new InferenceHost({ detector })
}
