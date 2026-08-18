import type { AnswerCode } from '@hv-pony-solver/shared/answer'

export type Detection = Readonly<{
  class_id: number
  confidence: number
}>

export type YoloParseResult = Readonly<{
  success: boolean
  ponies: AnswerCode[]
  confidences: Partial<Record<AnswerCode, number>>
  detections: Detection[]
  candidates: Detection[]
}>

export interface DetectorService {
  detect(blob: Blob, signal?: AbortSignal): Promise<YoloParseResult>
  prepare(signal?: AbortSignal): Promise<void>
  destroy(): void
}

export interface VerifiedModelDetectorService extends DetectorService {
  /**
   * Takes ownership of a model buffer whose canonical length and SHA-256 were
   * already verified. The buffer may be transferred and become detached.
   */
  prepareFromVerifiedModel(modelBuffer: ArrayBuffer, signal?: AbortSignal): Promise<void>
}

export type WorkerInitRequestPayload = Readonly<{
  type: 'init'
  modelBuffer: ArrayBuffer
}>

export type WorkerDetectRequestPayload = Readonly<{
  type: 'detect'
  imageBlob: Blob
}>

export type WorkerRequestPayload = WorkerInitRequestPayload | WorkerDetectRequestPayload
export type WorkerInitRequest = WorkerInitRequestPayload & Readonly<{ requestId: number }>
export type WorkerDetectRequest = WorkerDetectRequestPayload & Readonly<{ requestId: number }>
export type WorkerRequest = WorkerInitRequest | WorkerDetectRequest

export type WorkerResponse = Readonly<{
  type: 'response'
  requestId: number
  result?: YoloParseResult
}>

export type WorkerErrorResponse = Readonly<{
  type: 'error'
  requestId: number
  message: string
  fatal?: boolean
}>

export type WorkerMessage = WorkerResponse | WorkerErrorResponse
