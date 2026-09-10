import type { DetectRequest } from './port-messages'

export const MAX_IMAGE_BYTE_LENGTH = 2 * 1024 * 1024
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTE_LENGTH / 3) * 4

export function isMimeType(value: unknown): value is string {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/gif' || value === 'image/webp'
}

export function isBase64(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_IMAGE_BASE64_LENGTH ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return false
  }
  let paddingLength = 0
  if (value.endsWith('==')) {
    paddingLength = 2
  } else if (value.endsWith('=')) {
    paddingLength = 1
  }
  const decodedLength = (value.length / 4) * 3 - paddingLength
  return decodedLength >= 1 && decodedLength <= MAX_IMAGE_BYTE_LENGTH
}

function readBlobBase64(blob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    let settled = false
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onSignalAbort)
      reader.onerror = null
      reader.onabort = null
      reader.onload = null
    }
    const finish = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      callback()
    }
    const cancel = (): void => finish(() => reject(new Error('验证码图片读取已取消')))
    const onSignalAbort = (): void => {
      try {
        if (reader.readyState === FileReader.LOADING) {
          reader.abort()
        }
      } finally {
        cancel()
      }
    }
    reader.onerror = () => finish(() => reject(reader.error ?? new Error('验证码图片读取失败')))
    reader.onabort = cancel
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const separator = reader.result.indexOf(',')
        const encoded = separator >= 0 ? reader.result.slice(separator + 1) : ''
        if (isBase64(encoded)) {
          finish(() => resolve(encoded))
          return
        }
      }
      finish(() => reject(new Error('验证码图片读取结果无效')))
    }
    signal?.addEventListener('abort', onSignalAbort, { once: true })
    if (signal?.aborted) {
      onSignalAbort()
      return
    }
    try {
      reader.readAsDataURL(blob)
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))
    }
  })
}

export async function encodeImage(
  blob: Blob,
  signal?: AbortSignal,
): Promise<Pick<DetectRequest, 'imageBase64' | 'mimeType'>> {
  if (blob.size < 1 || blob.size > MAX_IMAGE_BYTE_LENGTH) {
    throw new Error('验证码图片大小无效')
  }
  if (!isMimeType(blob.type)) {
    throw new Error('验证码图片类型不受支持')
  }
  return {
    imageBase64: await readBlobBase64(blob, signal),
    mimeType: blob.type,
  }
}

export function decodeImage(request: DetectRequest): Blob {
  // The upstream isOffscreenRequest gate has already run the full isHostRequest
  // validation; this sits on the trusted Host path, so only the detect type is
  // re-checked here. Length and base64 shape are still validated explicitly.
  if (request.type !== 'detect') {
    throw new Error('验证码图片消息无效')
  }
  if (!isBase64(request.imageBase64)) {
    throw new Error('验证码图片编码无效')
  }
  if (!isMimeType(request.mimeType)) {
    throw new Error('验证码图片类型不受支持')
  }
  let binary: string
  try {
    binary = atob(request.imageBase64)
  } catch {
    throw new Error('验证码图片编码无效')
  }
  if (binary.length < 1 || binary.length > MAX_IMAGE_BYTE_LENGTH) {
    throw new Error('验证码图片大小无效')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: request.mimeType })
}
