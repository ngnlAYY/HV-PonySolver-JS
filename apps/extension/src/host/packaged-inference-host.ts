import { OnnxWorkerClient } from '@hv-pony-solver/browser-core/inference/onnx-worker-client'

import { runtimeGetUrl } from '../platform/webextension'
import { InferenceHost } from './inference-host'
import { PackagedModelRepository } from './packaged-model-repository'
import { createForwardingStatusSink, silentStatusSink, type HostStatusEmitter } from './status-sink'

export function createPackagedInferenceHost(emitStatus?: HostStatusEmitter): InferenceHost {
  const statusSink = emitStatus ? createForwardingStatusSink(emitStatus) : silentStatusSink
  const detector = new OnnxWorkerClient(
    new PackagedModelRepository(),
    statusSink,
    () => new Worker(runtimeGetUrl('inference-worker.js'), { type: 'module' }),
  )
  return new InferenceHost({ detector })
}
