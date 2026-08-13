import * as ort from 'onnxruntime-web/wasm'

import { startOnnxWorker } from '@hv-pony-solver/browser-core/inference/onnx-worker-entry'

import { loadPackagedRuntimeWasm } from './packaged-wasm'

startOnnxWorker(ort, async (runtime) => {
  runtime.env.wasm.numThreads = 1
  runtime.env.wasm.proxy = false
  runtime.env.wasm.wasmBinary = await loadPackagedRuntimeWasm()
})
