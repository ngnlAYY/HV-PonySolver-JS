import { MODEL_FILENAME } from '@hv-pony-solver/shared'

export const modelConfig = {
  accessKey: '',
  urlBase: 'https://models.ngnl.host/yolo26n-640.onnx',
  cacheName: 'pony-solver-local',
  cacheKey: MODEL_FILENAME,
  version: 'yolo26n-640-2026-05-14',
  integrity: {
    byteLength: 9809075,
    sha256: '318e96a0c32202fea2f4c0aed6010f5ba4a13952f5206a9b1cddc9a4fcf1f070',
  },
} as const
