import { describe, expect, it } from 'vitest'

import { DEFAULT_PUBLIC_MODEL_PATH, MODEL_FILENAME, MODEL_INTEGRITY, MODEL_VERSION } from '../src/model'

describe('model manifest', () => {
  it('keeps the public model path derived from the model filename', () => {
    expect(MODEL_FILENAME).toBe('yolo26n-640.onnx')
    expect(DEFAULT_PUBLIC_MODEL_PATH).toBe(`/${MODEL_FILENAME}`)
  })

  it('defines stable model version and integrity metadata', () => {
    expect(MODEL_VERSION).toBe('yolo26n-640-2026-05-14')
    expect(MODEL_INTEGRITY.byteLength).toBe(9809075)
    expect(MODEL_INTEGRITY.sha256).toBe('318e96a0c32202fea2f4c0aed6010f5ba4a13952f5206a9b1cddc9a4fcf1f070')
  })
})
