import { isYoloParseResult } from '@hv-pony-solver/browser-core/inference/inference-result-guard'
import type { YoloParseResult } from '@hv-pony-solver/browser-core/inference/inference-types'
import { MODEL_ACCESS_TOKEN_PATTERN } from '@hv-pony-solver/shared/token'

import { isBase64, isMimeType } from './image-payload'
import { PROTOCOL_VERSION, hasAllowedKeys, hasOnlyKeys, isRecord, isRequestId } from './protocol-validation'

type RequestBase = Readonly<{
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}>

export type PrepareRequest = RequestBase & Readonly<{ type: 'prepare' }>
export type DownloadModelRequest = RequestBase & Readonly<{ type: 'download-model' }>
export type QueryModelQuotaRequest = RequestBase & Readonly<{ type: 'query-model-quota' }>
export type DetectRequest = RequestBase &
  Readonly<{
    type: 'detect'
    imageBase64: string
    mimeType: string
  }>
export type VerifyKeyRequest = RequestBase & Readonly<{ type: 'verify-key'; candidateKey: string }>
export type ClearKeyRequest = RequestBase & Readonly<{ type: 'clear-key' }>
export type KeyIntentRequest = VerifyKeyRequest | ClearKeyRequest | QueryModelQuotaRequest
export type SerializedModelRequest = KeyIntentRequest | DownloadModelRequest
export type HostRequest = PrepareRequest | DownloadModelRequest | DetectRequest | KeyIntentRequest

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

function isHostErrorKind(value: unknown): value is HostErrorKind {
  return value === 'permanent-model' || value === 'transient'
}

export function isModelAccessKey(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ACCESS_TOKEN_PATTERN.test(value.trim())
}

export function isHostRequest(value: unknown): value is HostRequest {
  if (!isRecord(value) || value.protocol !== PROTOCOL_VERSION || !isRequestId(value.requestId)) {
    return false
  }
  if (
    value.type === 'prepare' ||
    value.type === 'download-model' ||
    value.type === 'query-model-quota' ||
    value.type === 'clear-key'
  ) {
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
    if (value.result !== undefined && !isYoloParseResult(value.result)) {
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
