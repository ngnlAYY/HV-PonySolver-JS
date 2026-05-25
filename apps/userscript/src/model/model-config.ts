import { MODEL_FILENAME, MODEL_INTEGRITY, MODEL_VERSION } from '@hv-pony-solver/shared'

export const modelConfig = {
  accessKey: '',
  urlBase: 'https://models.ngnl.host/yolo26n-640.onnx',
  cacheName: 'pony-solver-local',
  cacheKey: MODEL_FILENAME,
  version: MODEL_VERSION,
  verifyIntegrity: true,
  integrity: MODEL_INTEGRITY,
} as const
