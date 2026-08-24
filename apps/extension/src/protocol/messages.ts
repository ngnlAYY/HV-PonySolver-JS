import type { Detection, YoloParseResult } from '@hv-pony-solver/browser-core/inference/inference-types'
import { ANSWER_CODES, type AnswerCode } from '@hv-pony-solver/shared/answer'

export const PROTOCOL_VERSION = 'hv-pony-solver/2' as const
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

/**
 * Asks the broker to abort one still-active request from the same Port.
 *
 * Unlike a Port disconnect this is request-scoped: it frees the queued or
 * running work without disturbing sibling requests on the same Port.
 */
export type CancelRequest = RequestBase & Readonly<{ type: 'cancel'; cancelRequestId: string }>

export type HostSuccessResponse = RequestBase &
  Readonly<{
    type: 'result'
    ok: true
    result?: YoloParseResult
    notice?: string
  }>
export type HostErrorKind = 'permanent-model' | 'transient'

export type HostErrorResponse = RequestBase &
  Readonly<{
    type: 'result'
    ok: false
    error: string
    errorKind: HostErrorKind
  }>
export type HostResponse = HostSuccessResponse | HostErrorResponse

export type OffscreenClaimRequest = Readonly<{
  type: typeof OFFSCREEN_MESSAGE_TYPE
  operation: 'claim'
  epoch: string
}>

export type OffscreenRequest = Readonly<{
  type: typeof OFFSCREEN_MESSAGE_TYPE
  operation: 'request'
  epoch: string
  requestId: string
  request: HostRequest
}>

export type OffscreenCancelRequest = Readonly<{
  type: typeof OFFSCREEN_MESSAGE_TYPE
  operation: 'cancel'
  epoch: string
  requestId: string
}>

export type OffscreenIdleConfirmationRequest = Readonly<{
  type: typeof OFFSCREEN_MESSAGE_TYPE
  operation: 'confirm-idle'
  epoch: string
  generation: number
}>

export type OffscreenMessage =
  OffscreenClaimRequest | OffscreenRequest | OffscreenCancelRequest | OffscreenIdleConfirmationRequest

export type OffscreenClaimResponse = Readonly<{
  type: typeof OFFSCREEN_MESSAGE_TYPE
  operation: 'claimed'
  epoch: string
  idleGeneration: number | null
  status?: HostStatusUpdate
}>

export type OffscreenIdleConfirmationResponse = Readonly<{
  type: typeof OFFSCREEN_MESSAGE_TYPE
  operation: 'idle-confirmed'
  epoch: string
  generation: number
  idle: boolean
}>

/**
 * A one-way Host-to-client stage update (model download, session build).
 *
 * The Host owns the model and session rows; the content client keeps the
 * inference row because only it can measure the full round trip.
 */
export type HostStatusUpdate = Readonly<Partial<Record<'model' | 'session' | 'inference', string>>>

export type PortStatusMessage = Readonly<{
  protocol: typeof PROTOCOL_VERSION
  type: 'status'
  status: HostStatusUpdate
}>

export type ModelCredentialsChangedMessage = Readonly<{
  protocol: typeof PROTOCOL_VERSION
  type: 'model-credentials-changed'
}>

export type OffscreenStatusMessage = Readonly<{
  type: typeof OFFSCREEN_MESSAGE_TYPE
  operation: 'status'
  epoch: string
  status: HostStatusUpdate
}>

export type OffscreenIdleMessage = Readonly<{
  type: typeof OFFSCREEN_MESSAGE_TYPE
  operation: 'idle'
  epoch: string
  generation: number
}>

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

function isEpoch(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isMimeType(value: unknown): value is string {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/gif' || value === 'image/webp'
}

function isBase64(value: unknown): value is string {
  // floor() keeps the worst-case decoded size at or below MAX_IMAGE_BYTE_LENGTH;
  // ceil() would admit an encoding that decodes to exactly one byte too many.
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.floor(MAX_IMAGE_BYTE_LENGTH / 3) * 4) {
    return false
  }
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
}

function isHostErrorKind(value: unknown): value is HostErrorKind {
  return value === 'permanent-model' || value === 'transient'
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

export function isCancelRequest(value: unknown): value is CancelRequest {
  return (
    isRecord(value) &&
    value.protocol === PROTOCOL_VERSION &&
    value.type === 'cancel' &&
    isRequestId(value.requestId) &&
    isRequestId(value.cancelRequestId) &&
    hasOnlyKeys(value, ['protocol', 'type', 'requestId', 'cancelRequestId'])
  )
}

export function cancelRequestFor(cancelRequestId: string, requestId: string): CancelRequest {
  return { protocol: PROTOCOL_VERSION, type: 'cancel', requestId, cancelRequestId }
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
    hasOnlyKeys(value, ['protocol', 'type', 'requestId', 'ok', 'error', 'errorKind']) &&
    typeof value.error === 'string' &&
    value.error.length > 0 &&
    value.error.length <= 1000 &&
    isHostErrorKind(value.errorKind)
  )
}

export function isOffscreenClaimRequest(value: unknown): value is OffscreenClaimRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'operation', 'epoch']) &&
    value.type === OFFSCREEN_MESSAGE_TYPE &&
    value.operation === 'claim' &&
    isEpoch(value.epoch)
  )
}

export function isOffscreenRequest(value: unknown): value is OffscreenRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'operation', 'epoch', 'requestId', 'request']) &&
    value.type === OFFSCREEN_MESSAGE_TYPE &&
    value.operation === 'request' &&
    isEpoch(value.epoch) &&
    isRequestId(value.requestId) &&
    isHostRequest(value.request)
  )
}

export function isOffscreenCancelRequest(value: unknown): value is OffscreenCancelRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'operation', 'epoch', 'requestId']) &&
    value.type === OFFSCREEN_MESSAGE_TYPE &&
    value.operation === 'cancel' &&
    isEpoch(value.epoch) &&
    isRequestId(value.requestId)
  )
}

export function isOffscreenIdleConfirmationRequest(value: unknown): value is OffscreenIdleConfirmationRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'operation', 'epoch', 'generation']) &&
    value.type === OFFSCREEN_MESSAGE_TYPE &&
    value.operation === 'confirm-idle' &&
    isEpoch(value.epoch) &&
    isGeneration(value.generation)
  )
}

export function isOffscreenMessage(value: unknown): value is OffscreenMessage {
  return (
    isOffscreenClaimRequest(value) ||
    isOffscreenRequest(value) ||
    isOffscreenCancelRequest(value) ||
    isOffscreenIdleConfirmationRequest(value)
  )
}

export function isHostStatusUpdate(value: unknown): value is HostStatusUpdate {
  if (!isRecord(value)) {
    return false
  }
  const keys = Object.keys(value)
  if (keys.length === 0 || keys.length > 3) {
    return false
  }
  return keys.every((key) => {
    if (key !== 'model' && key !== 'session' && key !== 'inference') {
      return false
    }
    const text = value[key]
    return typeof text === 'string' && text.length > 0 && text.length <= 200
  })
}

export function portStatusMessage(status: HostStatusUpdate): PortStatusMessage {
  return { protocol: PROTOCOL_VERSION, type: 'status', status }
}

export function isPortStatusMessage(value: unknown): value is PortStatusMessage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['protocol', 'type', 'status']) &&
    value.protocol === PROTOCOL_VERSION &&
    value.type === 'status' &&
    isHostStatusUpdate(value.status)
  )
}

export function modelCredentialsChangedMessage(): ModelCredentialsChangedMessage {
  return { protocol: PROTOCOL_VERSION, type: 'model-credentials-changed' }
}

export function isModelCredentialsChangedMessage(value: unknown): value is ModelCredentialsChangedMessage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['protocol', 'type']) &&
    value.protocol === PROTOCOL_VERSION &&
    value.type === 'model-credentials-changed'
  )
}

export function offscreenStatusMessage(epoch: string, status: HostStatusUpdate): OffscreenStatusMessage {
  return { type: OFFSCREEN_MESSAGE_TYPE, operation: 'status', epoch, status }
}

export function isOffscreenStatusMessage(value: unknown): value is OffscreenStatusMessage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'operation', 'epoch', 'status']) &&
    value.type === OFFSCREEN_MESSAGE_TYPE &&
    value.operation === 'status' &&
    isEpoch(value.epoch) &&
    isHostStatusUpdate(value.status)
  )
}

export function isOffscreenIdleMessage(value: unknown): value is OffscreenIdleMessage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'operation', 'epoch', 'generation']) &&
    value.type === OFFSCREEN_MESSAGE_TYPE &&
    value.operation === 'idle' &&
    isEpoch(value.epoch) &&
    isGeneration(value.generation)
  )
}

export function isOffscreenClaimResponse(value: unknown): value is OffscreenClaimResponse {
  return (
    isRecord(value) &&
    hasAllowedKeys(value, ['type', 'operation', 'epoch', 'idleGeneration'], ['status']) &&
    value.type === OFFSCREEN_MESSAGE_TYPE &&
    value.operation === 'claimed' &&
    isEpoch(value.epoch) &&
    (value.idleGeneration === null || isGeneration(value.idleGeneration)) &&
    (value.status === undefined || isHostStatusUpdate(value.status))
  )
}

export function isOffscreenIdleConfirmationResponse(value: unknown): value is OffscreenIdleConfirmationResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['type', 'operation', 'epoch', 'generation', 'idle']) &&
    value.type === OFFSCREEN_MESSAGE_TYPE &&
    value.operation === 'idle-confirmed' &&
    isEpoch(value.epoch) &&
    isGeneration(value.generation) &&
    typeof value.idle === 'boolean'
  )
}

export function errorResponse(
  requestId: string,
  error: string,
  errorKind: HostErrorKind = 'transient',
): HostErrorResponse {
  return {
    protocol: PROTOCOL_VERSION,
    type: 'result',
    requestId,
    ok: false,
    error: error.slice(0, 1000) || '未知错误',
    errorKind,
  }
}

export function successResponse(requestId: string, result?: YoloParseResult, notice?: string): HostSuccessResponse {
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
