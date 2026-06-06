export const inferenceConfig = {
  imageSize: 640,
  confidenceThreshold: 0.30,
  maxDetections: 16,
  maxKinds: 3,
  yoloOutputConfig: {
    rowSize: 6,
    confidenceIndex: 4,
    classIndex: 5,
  },
  ortScriptUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js',
  ortWasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/',
  workerInitTimeoutMs: 60000,
  workerDetectTimeoutMs: 30000,
  modelDownloadTimeoutMs: 30000,
} as const
