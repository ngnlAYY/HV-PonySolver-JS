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

  it('keeps a 1xN image at one pixel wide and centers it horizontally', () => {
    expect(calculateLetterboxLayout(1, 640, 640)).toEqual({
      width: 1,
      height: 640,
      x: 319,
      y: 0,
    })
  })

  it('keeps an Nx1 image at one pixel high and centers it vertically', () => {
    expect(calculateLetterboxLayout(640, 1, 640)).toEqual({
      width: 640,
      height: 1,
      x: 0,
      y: 319,
    })
  })

  it('fills the target for square images', () => {
    expect(calculateLetterboxLayout(320, 320, 640)).toEqual({
      width: 640,
      height: 640,
      x: 0,
      y: 0,
    })
  })

  it('scales small images up while preserving aspect ratio', () => {
    expect(calculateLetterboxLayout(32, 16, 640)).toEqual({
      width: 640,
      height: 320,
      x: 0,
      y: 160,
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
