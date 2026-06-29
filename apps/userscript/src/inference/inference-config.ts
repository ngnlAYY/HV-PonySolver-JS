import { ONNX_RUNTIME_ASSETS } from './onnx-runtime-assets'

export const imagePreprocessConfig = {
  imageSize: 640,
} as const

export const yoloOutputConfig = {
  rowSize: 6,
  confidenceIndex: 4,
  classIndex: 5,
  confidenceThreshold: 0.30,
  maxDetections: 16,
  maxKinds: 3,
} as const

export const onnxRuntimeConfig = {
  ortScriptUrl: ONNX_RUNTIME_ASSETS.cdn.scriptUrl,
  ortWasmPath: ONNX_RUNTIME_ASSETS.cdn.wasmPath,
} as const

export const inferenceTimeoutConfig = {
  workerInitTimeoutMs: 60000,
  workerDetectTimeoutMs: 30000,
  modelDownloadTimeoutMs: 30000,
} as const
