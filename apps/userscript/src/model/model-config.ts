import { MODEL_FILENAME } from '@hv-pony-solver/shared'

export const modelConfig = {
  accessKey: '',
  urlBase: 'https://models.ngnl.host/yolo26n-640.onnx',
  cacheName: 'pony-solver-local',
  cacheKey: MODEL_FILENAME,
  version: 'yolo26n-640-2026-05-14',
} as const
