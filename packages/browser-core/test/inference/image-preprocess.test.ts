import { describe, expect, it, vi } from 'vitest'
import { imagePreprocessConfig } from '../../src/inference/inference-config'
import {
  assertInferenceImageDimensions,
  calculateLetterboxLayout,
  copyRgbaToChwFloat32,
  inspectEncodedImageDimensions,
  validateInferenceImageBeforeDecode,
} from '../../src/inference/image-preprocess'

function createPngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function createJpegBytes(options: Readonly<{ width: number; height: number; zeroPadding?: number }>): Uint8Array {
  const values: number[] = [
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x07,
    0x08,
    (options.height >> 8) & 0xff,
    options.height & 0xff,
    (options.width >> 8) & 0xff,
    options.width & 0xff,
  ]
  for (let i = 0; i < (options.zeroPadding ?? 0); i += 1) {
    values.push(0x00)
  }
  return new Uint8Array(values)
}

function createGifHeader(width: number, height: number, version: '87a' | '89a' = '89a'): Uint8Array {
  const bytes = new Uint8Array(10)
  bytes.set(version === '89a' ? [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] : [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
  const view = new DataView(bytes.buffer)
  view.setUint16(6, width, true)
  view.setUint16(8, height, true)
  return bytes
}

function createWebpHeader(codec: 'VP8X' | 'VP8L' | 'VP8', width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(codec === 'VP8L' ? 25 : 30)
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)
  if (codec === 'VP8X') {
    bytes.set([0x56, 0x50, 0x38, 0x58], 12)
    const encodedWidth = width - 1
    const encodedHeight = height - 1
    bytes.set([encodedWidth & 0xff, (encodedWidth >>> 8) & 0xff, (encodedWidth >>> 16) & 0xff], 24)
    bytes.set([encodedHeight & 0xff, (encodedHeight >>> 8) & 0xff, (encodedHeight >>> 16) & 0xff], 27)
  } else if (codec === 'VP8L') {
    bytes.set([0x56, 0x50, 0x38, 0x4c], 12)
    bytes[20] = 0x2f
    const bits = ((width - 1) | ((height - 1) << 14)) >>> 0
    new DataView(bytes.buffer).setUint32(21, bits, true)
  } else {
    bytes.set([0x56, 0x50, 0x38, 0x20], 12)
    bytes.set([0x9d, 0x01, 0x2a], 23)
    const view = new DataView(bytes.buffer)
    view.setUint16(26, width, true)
    view.setUint16(28, height, true)
  }
  return bytes
}

function createBlob(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy.buffer])
}

const additionalEncodedDimensionCases = [
  ['GIF87a', (width: number, height: number) => createGifHeader(width, height, '87a')],
  ['GIF89a', (width: number, height: number) => createGifHeader(width, height, '89a')],
  ['WebP VP8X', (width: number, height: number) => createWebpHeader('VP8X', width, height)],
  ['WebP VP8L', (width: number, height: number) => createWebpHeader('VP8L', width, height)],
  ['WebP VP8', (width: number, height: number) => createWebpHeader('VP8', width, height)],
] as const

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
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 128, 255, 255])
    const output = new Float32Array(6)

    copyRgbaToChwFloat32(rgba, output, 2)

    expect([...output]).toEqual([1, 0, 0, expect.closeTo(128 / 255), 0, 1])
  })

  it('reads PNG dimensions from encoded bytes before decode', async () => {
    const bytes = createPngHeader(320, 160)

    expect(inspectEncodedImageDimensions(bytes)).toEqual({ width: 320, height: 160 })
    await expect(validateInferenceImageBeforeDecode(createBlob(bytes))).resolves.toEqual({
      width: 320,
      height: 160,
    })
  })

  it('rejects encoded image bytes above the configured limit before reading them', async () => {
    const blob = createBlob(new Uint8Array(imagePreprocessConfig.maxEncodedBytes + 1))
    const arrayBuffer = vi.fn()
    Object.defineProperty(blob, 'arrayBuffer', { value: arrayBuffer })

    await expect(validateInferenceImageBeforeDecode(blob)).rejects.toThrow('验证码图片数据超过限制')
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('rejects an encoded PNG side length above the configured limit before decode', async () => {
    const blob = createBlob(createPngHeader(imagePreprocessConfig.maxSourceSide + 1, 1))

    await expect(validateInferenceImageBeforeDecode(blob)).rejects.toThrow('验证码图片边长超过限制')
  })

  it('rejects encoded PNG total source pixels above the configured limit before decode', async () => {
    const blob = createBlob(createPngHeader(4_001, 4_000))

    await expect(validateInferenceImageBeforeDecode(blob)).rejects.toThrow('验证码图片像素总数超过限制')
  })

  it('rejects empty and non-integral source dimensions', async () => {
    await expect(validateInferenceImageBeforeDecode(new Blob([]))).rejects.toThrow('验证码图片数据为空')
    expect(() => assertInferenceImageDimensions(10.5, 10)).toThrow('验证码图片尺寸无效')
  })

  it('reads JPEG dimensions from a small blob before decode', async () => {
    await expect(
      validateInferenceImageBeforeDecode(createBlob(createJpegBytes({ width: 320, height: 160 }))),
    ).resolves.toEqual({
      width: 320,
      height: 160,
    })
  })

  for (const [format, createBytes] of additionalEncodedDimensionCases) {
    it(`reads ${format} dimensions and accepts the exact pixel boundary`, async () => {
      const regular = createBytes(320, 160)
      const boundary = createBytes(4_000, 4_000)

      expect(inspectEncodedImageDimensions(regular)).toEqual({ width: 320, height: 160 })
      await expect(validateInferenceImageBeforeDecode(createBlob(boundary))).resolves.toEqual({
        width: 4_000,
        height: 4_000,
      })
    })

    it(`rejects ${format} dimensions above the side and pixel limits`, async () => {
      await expect(
        validateInferenceImageBeforeDecode(createBlob(createBytes(imagePreprocessConfig.maxSourceSide + 1, 1))),
      ).rejects.toThrow('验证码图片边长超过限制')
      await expect(validateInferenceImageBeforeDecode(createBlob(createBytes(4_001, 4_000)))).rejects.toThrow(
        '验证码图片像素总数超过限制',
      )
    })
  }

  it('rejects truncated or invalid GIF and WebP dimension headers', () => {
    expect(() => inspectEncodedImageDimensions(createGifHeader(1, 1).slice(0, 9))).toThrow('验证码图片 GIF 头无效')
    expect(() => inspectEncodedImageDimensions(createWebpHeader('VP8X', 1, 1).slice(0, 29))).toThrow(
      '验证码图片 WebP VP8X 头无效',
    )
    const invalidVp8l = createWebpHeader('VP8L', 1, 1)
    invalidVp8l[20] = 0
    expect(() => inspectEncodedImageDimensions(invalidVp8l)).toThrow('验证码图片 WebP VP8L 头无效')
    const invalidVp8 = createWebpHeader('VP8', 1, 1)
    invalidVp8[23] = 0
    expect(() => inspectEncodedImageDimensions(invalidVp8)).toThrow('验证码图片 WebP VP8 头无效')
    const unknownWebp = new Uint8Array(21)
    unknownWebp.set([0x52, 0x49, 0x46, 0x46], 0)
    unknownWebp.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(() => inspectEncodedImageDimensions(unknownWebp)).toThrow('验证码图片 WebP 编码无效')
  })

  it('rejects a truncated small JPEG header before decode', async () => {
    await expect(validateInferenceImageBeforeDecode(createBlob(new Uint8Array([0xff, 0xd8, 0xff])))).rejects.toThrow(
      '验证码图片 JPEG 缺少尺寸信息',
    )
    await expect(
      validateInferenceImageBeforeDecode(createBlob(createJpegBytes({ width: 320, height: 160 }).slice(0, 10))),
    ).rejects.toThrow('验证码图片 JPEG 头无效')
  })

  it('validates oversized JPEG dimensions found inside the scan prefix', async () => {
    const blob = createBlob(
      createJpegBytes({ width: imagePreprocessConfig.maxSourceSide + 1, height: 1, zeroPadding: 70_000 }),
    )

    await expect(validateInferenceImageBeforeDecode(blob)).rejects.toThrow('验证码图片边长超过限制')
  })

  it('passes oversized JPEGs without an in-window SOF through to the decode-time check', async () => {
    const bytes = new Uint8Array(70_000)
    bytes[0] = 0xff
    bytes[1] = 0xd8
    const blob = createBlob(bytes)

    await expect(validateInferenceImageBeforeDecode(blob)).resolves.toBeNull()
  })
})
