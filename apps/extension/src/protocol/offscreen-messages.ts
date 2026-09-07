import type { HostRequest, HostStatusUpdate } from './port-messages'
import { isHostRequest, isHostStatusUpdate } from './port-messages'
import {
  OFFSCREEN_MESSAGE_TYPE,
  hasAllowedKeys,
  hasOnlyKeys,
  isEpoch,
  isGeneration,
  isRecord,
  isRequestId,
} from './protocol-validation'

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

export function offscreenStatusMessage(epoch: string, status: HostStatusUpdate): OffscreenStatusMessage {
  return { type: OFFSCREEN_MESSAGE_TYPE, operation: 'status', epoch, status }
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
