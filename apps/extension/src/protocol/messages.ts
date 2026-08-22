import type { Detection, YoloParseResult } from '@hv-pony-solver/browser-core/inference/inference-types'
import { ANSWER_CODES, type AnswerCode } from '@hv-pony-solver/shared/answer'

export const PROTOCOL_VERSION = 'hv-pony-solver/1' as const
export const CONTENT_PORT_NAME = 'hv-pony-solver:content' as const
export const OPTIONS_PORT_NAME = 'hv-pony-solver:options' as const
export const OFFSCREEN_MESSAGE_TYPE = 'hv-pony-solver:offscreen-request' as const
export const MAX_IMAGE_BYTE_LENGTH = 2 * 1024 * 1024
export const MODEL_ACCESS_KEY_LENGTH = 64

type RequestBase = Readonly<{
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}>

export type PrepareRequest = RequestBase & Readonly<{ type: 'prepare' }>
export type DetectRequest = RequestBase &
  Readonly<{
    type: 'detect'
    imageBase64: string
    mimeType: string
  }>
export type VerifyKeyRequest = RequestBase & Readonly<{ type: 'verify-key'; candidateKey: string }>
export type ClearKeyRequest = RequestBase & Readonly<{ type: 'clear-key' }>
export type KeyIntentRequest = VerifyKeyRequest | ClearKeyRequest
export type HostRequest = PrepareRequest | DetectRequest | KeyIntentRequest

export type HostSuccessResponse = RequestBase &
  Readonly<{
    type: 'result'
    ok: true
    result?: YoloParseResult
    notice?: string
  }>
export type HostErrorResponse = RequestBase &
  Readonly<{
    type: 'result'
    ok: false
    error: string
  }>
export type HostResponse = HostSuccessResponse | HostErrorResponse

export type OffscreenRequest = Readonly<{
  type: typeof OFFSCREEN_MESSAGE_TYPE
  operation: 'request'
  requestId: string
  request: HostRequest
}>

export type OffscreenCancelRequest = Readonly<{
  type: typeof OFFSCREEN_MESSAGE_TYPE
  operation: 'cancel'
  requestId: string
}>

export type OffscreenMessage = OffscreenRequest | OffscreenCancelRequest

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key))
}

function hasAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional])
  return (
    required.every((key) => key in value) &&
    Object.keys(value).length <= allowed.size &&
    Object.keys(value).every((key) => allowed.has(key))
  )
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

function isMimeType(value: unknown): value is string {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/gif' || value === 'image/webp'
}

function isBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(MAX_IMAGE_BYTE_LENGTH / 3) * 4) {
    return false
  }
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
}

export function isModelAccessKey(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${MODEL_ACCESS_KEY_LENGTH}}$`, 'i').test(value.trim())
}

function isDetection(value: unknown): value is Detection {
  return (
    isRecord(value) &&
    Number.isInteger(value.class_id) &&
    typeof value.confidence === 'number' &&
    Number.isFinite(value.confidence)
  )
}

function isAnswerCode(value: unknown): value is AnswerCode {
  return typeof value === 'string' && ANSWER_CODES.includes(value as AnswerCode)
}

function isYoloResult(value: unknown): value is YoloParseResult {
  if (!isRecord(value) || typeof value.success !== 'boolean' || !Array.isArray(value.ponies)) {
    return false
  }
  if (!value.ponies.every(isAnswerCode) || !isRecord(value.confidences)) {
    return false
  }
  for (const [key, confidence] of Object.entries(value.confidences)) {
    if (!isAnswerCode(key) || typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      return false
    }
  }
  return (
    Array.isArray(value.detections) &&
    value.detections.every(isDetection) &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isDetection)
  )
}

export function isHostRequest(value: unknown): value is HostRequest {
  if (!isRecord(value) || value.protocol !== PROTOCOL_VERSION || !isRequestId(value.requestId)) {
    return false
  }
  if (value.type === 'prepare' || value.type === 'clear-key') {
    return hasOnlyKeys(value, ['protocol', 'type', 'requestId'])
  }
  if (value.type === 'detect') {
    return (
      hasOnlyKeys(value, ['protocol', 'type', 'requestId', 'imageBase64', 'mimeType']) &&
      isBase64(value.imageBase64) &&
      isMimeType(value.mimeType)
    )
  }
  return (
    value.type === 'verify-key' &&
    hasOnlyKeys(value, ['protocol', 'type', 'requestId', 'candidateKey']) &&
    isModelAccessKey(value.candidateKey)
  )
}

export function isHostResponse(value: unknown): value is HostResponse {
  if (
    !isRecord(value) ||
    value.protocol !== PROTOCOL_VERSION ||
    value.type !== 'result' ||
    !isRequestId(value.requestId) ||
    typeof value.ok !== 'boolean'
  ) {
    return false
  }
  if (value.ok) {
    if (!hasAllowedKeys(value, ['protocol', 'type', 'requestId', 'ok'], ['result', 'notice'])) {
      return false
    }
    if (value.result !== undefined && !isYoloResult(value.result)) {
      return false
    }
    return (
      value.notice === undefined ||
      (typeof value.notice === 'string' && value.notice.length > 0 && value.notice.length <= 1000)
    )
  }
  return (
    hasOnlyKeys(value, ['protocol', 'type', 'requestId', 'ok', 'error']) &&
    typeof value.error === 'string' &&
    value.error.length > 0 &&
    value.error.length <= 1000
  )
}

export function isOffscreenRequest(value: unknown): value is OffscreenRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'operation', 'requestId', 'request']) &&
    value.type === OFFSCREEN_MESSAGE_TYPE &&
    value.operation === 'request' &&
    isRequestId(value.requestId) &&
    isHostRequest(value.request)
  )
}

export function isOffscreenCancelRequest(value: unknown): value is OffscreenCancelRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'operation', 'requestId']) &&
    value.type === OFFSCREEN_MESSAGE_TYPE &&
    value.operation === 'cancel' &&
    isRequestId(value.requestId)
  )
}

export function isOffscreenMessage(value: unknown): value is OffscreenMessage {
  return isOffscreenRequest(value) || isOffscreenCancelRequest(value)
}

export function errorResponse(requestId: string, error: string): HostErrorResponse {
  return {
    protocol: PROTOCOL_VERSION,
    type: 'result',
    requestId,
    ok: false,
    error: error.slice(0, 1000) || '未知错误',
  }
}

export function successResponse(
  requestId: string,
  result?: YoloParseResult,
  notice?: string,
): HostSuccessResponse {
  return {
    protocol: PROTOCOL_VERSION,
    type: 'result',
    requestId,
    ok: true,
    ...(result === undefined ? {} : { result }),
    ...(notice ? { notice: notice.slice(0, 1000) } : {}),
  }
}

function readBlobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('验证码图片读取失败'))
    reader.onabort = () => reject(new Error('验证码图片读取已取消'))
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const separator = reader.result.indexOf(',')
        const encoded = separator >= 0 ? reader.result.slice(separator + 1) : ''
        if (isBase64(encoded)) {
          resolve(encoded)
          return
        }
      }
      reject(new Error('验证码图片读取结果无效'))
    }
    reader.readAsDataURL(blob)
  })
}

export async function encodeImage(blob: Blob): Promise<Pick<DetectRequest, 'imageBase64' | 'mimeType'>> {
  if (blob.size < 1 || blob.size > MAX_IMAGE_BYTE_LENGTH) {
    throw new Error('验证码图片大小无效')
  }
  if (!isMimeType(blob.type)) {
    throw new Error('验证码图片类型不受支持')
  }
  return {
    imageBase64: await readBlobBase64(blob),
    mimeType: blob.type,
  }
}

export function decodeImage(request: DetectRequest): Blob {
  if (!isHostRequest(request) || request.type !== 'detect') {
    throw new Error('验证码图片消息无效')
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
