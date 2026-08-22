export const imagePreprocessConfig = {
  imageSize: 640,
  maxEncodedBytes: 2 * 1024 * 1024,
  maxSourceSide: 4096,
  maxSourcePixels: 16_000_000,
} as const

export const yoloOutputConfig = {
  rowSize: 6,
  confidenceIndex: 4,
  classIndex: 5,
  confidenceThreshold: 0.3,
  maxDetections: 16,
  maxKinds: 3,
  maxOutputRows: 100_000,
} as const

export const inferenceTimeoutConfig = {
  workerInitTimeoutMs: 60000,
  workerDetectTimeoutMs: 30000,
  workerAbortGraceTimeoutMs: 1000,
  workerPrepareTimeoutMs: 100000,
  modelDownloadTimeoutMs: 30000,
  modelProbeTimeoutMs: 10000,
  modelCacheTimeoutMs: 5000,
} as const

export const inferenceRecoveryConfig = {
  maxConsecutiveWorkerErrors: 3,
} as const
