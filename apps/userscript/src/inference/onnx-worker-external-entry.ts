import type * as Ort from 'onnxruntime-web/wasm'

import { startOnnxWorker } from './onnx-worker-entry'

declare const __HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_URL__: string
declare const __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BASE_URL__: string

type ExternalWorkerScope = typeof globalThis & {
  importScripts(...urls: string[]): void
  ort?: typeof Ort
}

const externalWorkerScope = globalThis as ExternalWorkerScope
externalWorkerScope.importScripts(__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_URL__)

const ort = externalWorkerScope.ort
if (!ort) {
  throw new Error('远程 ONNX Runtime 未注册全局 ort')
}

startOnnxWorker(ort, (runtime) => {
  runtime.env.wasm.numThreads = 1
  runtime.env.wasm.proxy = false
  runtime.env.wasm.wasmPaths = __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BASE_URL__
})
