import { describe, expect, it } from 'vitest'
import { calculateLetterboxLayout, copyRgbaToChwFloat32 } from '../../src/inference/image-preprocess'

describe('image preprocessing helpers', () => {
  it('calculates centered letterbox layout for wide images', () => {
    expect(calculateLetterboxLayout(200, 100, 640)).toEqual({
      width: 640,
      height: 320,
      x: 0,
      y: 160,
    })
  })

  it('calculates centered letterbox layout for tall images', () => {
    expect(calculateLetterboxLayout(100, 200, 640)).toEqual({
      width: 320,
      height: 640,
      x: 160,
      y: 0,
    })
  })

  it('copies RGBA image data into CHW float32 RGB planes', () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 128, 255, 255,
    ])
    const output = new Float32Array(6)

    copyRgbaToChwFloat32(rgba, output, 2)

    expect([...output]).toEqual([1, 0, 0, expect.closeTo(128 / 255), 0, 1])
  })
})
