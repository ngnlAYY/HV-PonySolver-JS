import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY, MODEL_VERSION } from '@hv-pony-solver/shared'

export const modelConfig = {
  accessKey: '',
  urlBase: 'https://models.ngnl.host/yolo26n-640.ort',
  quotaUrl: 'https://models.ngnl.host/quota',
  cacheName: 'pony-solver-local',
  cacheKey: ORT_MODEL_FILENAME,
  version: MODEL_VERSION,
  verifyIntegrity: true,
  integrity: ORT_MODEL_INTEGRITY,
} as const
