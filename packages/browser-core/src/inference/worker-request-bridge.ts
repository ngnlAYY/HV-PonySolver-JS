import { inferenceTimeoutConfig } from './inference-config'
import { isYoloParseResult } from './inference-result-guard'
import type {
  WorkerDetectRequestPayload,
  WorkerDetectResponse,
  WorkerInitRequestPayload,
  WorkerInitResponse,
  WorkerRequestPayload,
  WorkerResponse,
} from './inference-types'
import { formatErrorMessage } from '../utils/errors'
import { isRecordObject } from '../utils/guards'

type PendingRequest = Readonly<{
  requestType: WorkerRequestPayload['type']
  resolve: (message: WorkerResponse) => void
  reject: (error: unknown) => void
  timeoutId: ReturnType<typeof setTimeout>
}>

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
}

function hasAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key))
}

function isWorkerErrorResponse(message: Record<string, unknown>, requestId: number): boolean {
  return (
    message.type === 'error' &&
    message.requestId === requestId &&
    hasAllowedKeys(message, ['type', 'requestId', 'message'], ['fatal']) &&
    typeof message.message === 'string' &&
    message.message.length > 0 &&
    message.message.length <= 1_000 &&
    (message.fatal === undefined || typeof message.fatal === 'boolean')
  )
}

function isWorkerResponse(
  message: Record<string, unknown>,
  requestId: number,
  requestType: WorkerRequestPayload['type'],
): message is WorkerResponse {
  if (message.type !== 'response' || message.requestId !== requestId) {
    return false
  }
  if (requestType === 'init') {
    return hasExactKeys(message, ['type', 'requestId', 'modelBuffer']) && message.modelBuffer instanceof ArrayBuffer
  }
  return hasExactKeys(message, ['type', 'requestId', 'result']) && isYoloParseResult(message.result)
}

export class WorkerResponseError extends Error {
  readonly fatal: boolean

  constructor(message: string, fatal: boolean) {
    super(message)
    this.name = 'WorkerResponseError'
    this.fatal = fatal
  }
}

/**
 * Marks request timeouts so recovery logic can distinguish a wedged session
 * (which must be discarded) from a Worker that answered with an error.
 */
export class WorkerRequestTimeoutError extends Error {
  constructor() {
    super('ONNX Worker 请求超时')
    this.name = 'WorkerRequestTimeoutError'
  }
}

export class WorkerRequestBridge {
  private readonly requests = new Map<number, PendingRequest>()
  private nextRequestId = 1

  constructor(
    private readonly worker: Worker,
    private readonly onFailure: (error: unknown) => void,
  ) {
    this.worker.onmessage = (event: MessageEvent<unknown>) => this.handleMessage(event)
  }

  post(message: WorkerInitRequestPayload, transfer?: Transferable[]): Promise<WorkerInitResponse>
  post(message: WorkerDetectRequestPayload, transfer?: Transferable[]): Promise<WorkerDetectResponse>
  post(message: WorkerRequestPayload, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const requestId = this.nextRequestId
    this.nextRequestId += 1
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timeoutMs =
        message.type === 'init'
          ? inferenceTimeoutConfig.workerInitTimeoutMs
          : inferenceTimeoutConfig.workerDetectTimeoutMs
      const timeoutId = setTimeout(() => {
        const error = new WorkerRequestTimeoutError()
        this.requests.delete(requestId)
        reject(error)
        this.onFailure(error)
      }, timeoutMs)
      this.requests.set(requestId, { requestType: message.type, resolve, reject, timeoutId })
      try {
        this.worker.postMessage({ ...message, requestId }, transfer)
      } catch (error) {
        clearTimeout(timeoutId)
        this.requests.delete(requestId)
        const contextualError = new Error(`ONNX Worker 消息发送失败: ${formatErrorMessage(error)}`, { cause: error })
        this.onFailure(contextualError)
        reject(contextualError)
      }
    })
  }

  handleMessage(event: MessageEvent<unknown>): void {
    const message = event.data
    if (!isRecordObject(message)) {
      return
    }
    const requestId = message.requestId
    if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId) || !this.requests.has(requestId)) {
      return
    }
    const pending = this.requests.get(requestId)
    if (!pending) {
      return
    }
    this.requests.delete(requestId)
    clearTimeout(pending.timeoutId)
    if (isWorkerErrorResponse(message, requestId)) {
      const error = new WorkerResponseError(message.message as string, message.fatal === true)
      pending.reject(error)
      if (error.fatal) {
        this.onFailure(error)
      }
      return
    }
    if (!isWorkerResponse(message, requestId, pending.requestType)) {
      const error = new WorkerResponseError('ONNX Worker 返回无效消息', true)
      pending.reject(error)
      this.onFailure(error)
      return
    }
    pending.resolve(message)
  }

  rejectPending(error: unknown): void {
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
    }
    this.requests.clear()
  }
}
