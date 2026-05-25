export const MODEL_FILENAME = 'yolo26n-640.onnx'
export const DEFAULT_PUBLIC_MODEL_PATH = `/${MODEL_FILENAME}`
export const MODEL_VERSION = 'yolo26n-640-2026-05-14'
export const MODEL_INTEGRITY = {
  byteLength: 9809075,
  sha256: '318e96a0c32202fea2f4c0aed6010f5ba4a13952f5206a9b1cddc9a4fcf1f070',
} as const

export type ModelAccessDecision = 'real' | 'decoy' | 'forbidden'
