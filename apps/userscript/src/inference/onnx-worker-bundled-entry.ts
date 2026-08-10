import * as ort from 'onnxruntime-web/wasm'

import { loadVerifiedRuntimeWasm } from './runtime-wasm-loader'
import { startOnnxWorker } from './onnx-worker-entry'

startOnnxWorker(ort, async (runtime) => {
  const wasmBinary = await loadVerifiedRuntimeWasm()
  runtime.env.wasm.numThreads = 1
  runtime.env.wasm.proxy = false
  runtime.env.wasm.wasmBinary = wasmBinary
})
