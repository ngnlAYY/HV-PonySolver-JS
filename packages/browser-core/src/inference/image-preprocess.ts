import { imagePreprocessConfig } from './inference-config'

export type LetterboxLayout = Readonly<{
  width: number
  height: number
  x: number
  y: number
}>

export type ImageDimensions = Readonly<{
  width: number
  height: number
}>

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? -1
}

function matchesBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => byteAt(bytes, offset + index) === value)
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  return byteAt(bytes, offset) * 0x100 + byteAt(bytes, offset + 1)
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return byteAt(bytes, offset) + byteAt(bytes, offset + 1) * 0x100
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return byteAt(bytes, offset) + byteAt(bytes, offset + 1) * 0x100 + byteAt(bytes, offset + 2) * 0x10000
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    byteAt(bytes, offset) * 0x1000000 +
    byteAt(bytes, offset + 1) * 0x10000 +
    byteAt(bytes, offset + 2) * 0x100 +
    byteAt(bytes, offset + 3)
  )
}

function inspectPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
  if (!matchesBytes(bytes, 0, signature)) {
    return null
  }
  if (bytes.byteLength < 24 || !matchesBytes(bytes, 12, [0x49, 0x48, 0x44, 0x52])) {
    throw new Error('验证码图片 PNG 头无效')
  }
  return {
    width: readUint32BigEndian(bytes, 16),
    height: readUint32BigEndian(bytes, 20),
  }
}

function inspectGifDimensions(bytes: Uint8Array): ImageDimensions | null {
  const isGif =
    matchesBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    matchesBytes(bytes, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  if (!isGif) {
    return null
  }
  if (bytes.byteLength < 10) {
    throw new Error('验证码图片 GIF 头无效')
  }
  return {
    width: readUint16LittleEndian(bytes, 6),
    height: readUint16LittleEndian(bytes, 8),
  }
}

const jpegStartOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function inspectJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!matchesBytes(bytes, 0, [0xff, 0xd8])) {
    return null
  }
  let offset = 2
  while (offset < bytes.byteLength) {
    while (byteAt(bytes, offset) === 0xff) {
      offset += 1
    }
    const marker = byteAt(bytes, offset)
    offset += 1
    if (marker < 0 || marker === 0xd9 || marker === 0xda) {
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue
    }
    if (offset + 2 > bytes.byteLength) {
      throw new Error('验证码图片 JPEG 头无效')
    }
    const segmentLength = readUint16BigEndian(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      throw new Error('验证码图片 JPEG 头无效')
    }
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) {
        throw new Error('验证码图片 JPEG 尺寸段无效')
      }
      return {
        width: readUint16BigEndian(bytes, offset + 5),
        height: readUint16BigEndian(bytes, offset + 3),
      }
    }
    offset += segmentLength
  }
  throw new Error('验证码图片 JPEG 缺少尺寸信息')
}

function inspectWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!matchesBytes(bytes, 0, [0x52, 0x49, 0x46, 0x46]) || !matchesBytes(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return null
  }
  if (bytes.byteLength < 21) {
    throw new Error('验证码图片 WebP 头无效')
  }
  if (matchesBytes(bytes, 12, [0x56, 0x50, 0x38, 0x58])) {
    if (bytes.byteLength < 30) {
      throw new Error('验证码图片 WebP VP8X 头无效')
    }
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    }
  }
  if (matchesBytes(bytes, 12, [0x56, 0x50, 0x38, 0x4c])) {
    if (bytes.byteLength < 25 || byteAt(bytes, 20) !== 0x2f) {
      throw new Error('验证码图片 WebP VP8L 头无效')
    }
    const bits =
      (byteAt(bytes, 21) | (byteAt(bytes, 22) << 8) | (byteAt(bytes, 23) << 16) | (byteAt(bytes, 24) << 24)) >>> 0
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    }
  }
  if (matchesBytes(bytes, 12, [0x56, 0x50, 0x38, 0x20])) {
    if (bytes.byteLength < 30 || !matchesBytes(bytes, 23, [0x9d, 0x01, 0x2a])) {
      throw new Error('验证码图片 WebP VP8 头无效')
    }
    return {
      width: readUint16LittleEndian(bytes, 26) & 0x3fff,
      height: readUint16LittleEndian(bytes, 28) & 0x3fff,
    }
  }
  throw new Error('验证码图片 WebP 编码无效')
}

/** Returns null for formats whose dimensions cannot be inspected before decode. */
export function inspectEncodedImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  return (
    inspectPngDimensions(bytes) ??
    inspectGifDimensions(bytes) ??
    inspectJpegDimensions(bytes) ??
    inspectWebpDimensions(bytes)
  )
}

export function assertInferenceImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('验证码图片尺寸无效')
  }
  if (width > imagePreprocessConfig.maxSourceSide || height > imagePreprocessConfig.maxSourceSide) {
    throw new Error(`验证码图片边长超过限制: ${width}x${height}`)
  }
  if (width * height > imagePreprocessConfig.maxSourcePixels) {
    throw new Error(`验证码图片像素总数超过限制: ${width}x${height}`)
  }
}

/** Fixed header size that always covers PNG/GIF/WebP dimension fields. */
const IMAGE_SNIFF_PREFIX_BYTES = 64
/**
 * JPEG dimension discovery walks variable-length segments with no header bound,
 * so the walk is capped at this prefix; larger images rely on the post-decode
 * dimension check instead of reading the whole blob before decoding.
 */
const JPEG_SCAN_PREFIX_LIMIT_BYTES = 64 * 1024

/**
 * Bounds compressed bytes first and inspects dimensions for PNG/GIF/JPEG/WebP
 * before createImageBitmap allocates decoded pixels. Unknown formats still get
 * the same dimension check immediately after decoding.
 */
export async function validateInferenceImageBeforeDecode(imageBlob: Blob): Promise<ImageDimensions | null> {
  if (!Number.isSafeInteger(imageBlob.size) || imageBlob.size < 1) {
    throw new Error('验证码图片数据为空')
  }
  if (imageBlob.size > imagePreprocessConfig.maxEncodedBytes) {
    throw new Error(`验证码图片数据超过限制: ${imageBlob.size}`)
  }
  const head = new Uint8Array(await imageBlob.slice(0, IMAGE_SNIFF_PREFIX_BYTES).arrayBuffer())
  const dimensions = matchesBytes(head, 0, [0xff, 0xd8])
    ? await inspectJpegDimensionsBeforeDecode(imageBlob)
    : inspectEncodedImageDimensions(head)
  if (dimensions) {
    assertInferenceImageDimensions(dimensions.width, dimensions.height)
  }
  return dimensions
}

async function inspectJpegDimensionsBeforeDecode(imageBlob: Blob): Promise<ImageDimensions | null> {
  if (imageBlob.size <= JPEG_SCAN_PREFIX_LIMIT_BYTES) {
    return inspectJpegDimensions(new Uint8Array(await imageBlob.arrayBuffer()))
  }
  try {
    return inspectJpegDimensions(new Uint8Array(await imageBlob.slice(0, JPEG_SCAN_PREFIX_LIMIT_BYTES).arrayBuffer()))
  } catch {
    // The segment walk ran past the scan window, so the image cannot be judged
    // here; treat the format as legal and let createImageBitmap decide.
    return null
  }
}

export function calculateLetterboxLayout(
  sourceWidth: number,
  sourceHeight: number,
  targetSize: number,
): LetterboxLayout {
  const scale = Math.min(targetSize / sourceHeight, targetSize / sourceWidth)
  const height = Math.max(1, Math.trunc(sourceHeight * scale))
  const width = Math.max(1, Math.trunc(sourceWidth * scale))
  return {
    width,
    height,
    x: Math.trunc((targetSize - width) / 2),
    y: Math.trunc((targetSize - height) / 2),
  }
}

export function copyRgbaToChwFloat32(rgba: Uint8ClampedArray, output: Float32Array, plane: number): void {
  // getImageData guarantees one RGBA quad per pixel, so no per-channel
  // fallback is needed here.
  for (let index = 0, offset = 0; index < plane; index += 1, offset += 4) {
    output[index] = rgba[offset]! / 255
    output[plane + index] = rgba[offset + 1]! / 255
    output[plane * 2 + index] = rgba[offset + 2]! / 255
  }
}
