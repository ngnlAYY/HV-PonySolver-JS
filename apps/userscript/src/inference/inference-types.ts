import type { AnswerCode } from '@hv-pony-solver/shared'

export type Detection = Readonly<{
  class_id: number
  confidence: number
}>

export type YoloParseResult = Readonly<{
  success: boolean
  ponies: AnswerCode[]
  confidences: Partial<Record<AnswerCode, number>>
  detections: Detection[]
}>

export interface DetectorService {
  detect(blob: Blob): Promise<YoloParseResult>
  prepare(): Promise<Worker>
  destroy(): void
}

export type WorkerInitRequest = Readonly<{
  type: 'init'
  requestId?: number
  ortScriptUrl?: string
  wasmPath: string
  modelBuffer: ArrayBuffer
}>

export type WorkerDetectRequest = Readonly<{
  type: 'detect'
  requestId?: number
  imageBlob: Blob
  size: number
}>

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
}>

export type WorkerMessage = WorkerResponse | WorkerErrorResponse
