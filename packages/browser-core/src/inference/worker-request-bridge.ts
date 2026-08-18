import { inferenceTimeoutConfig } from './inference-config'
import type { WorkerMessage, WorkerRequestPayload, WorkerResponse } from './inference-types'
import { formatErrorMessage } from '../utils/errors'
import { isRecordObject } from '../utils/guards'

type PendingRequest = Readonly<{
  resolve: (message: WorkerMessage) => void
  reject: (error: unknown) => void
  timeoutId: ReturnType<typeof setTimeout>
}>

export class WorkerResponseError extends Error {
  readonly fatal: boolean

  constructor(message: string, fatal: boolean) {
    super(message)
    this.name = 'WorkerResponseError'
    this.fatal = fatal
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

  post(message: WorkerRequestPayload, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const requestId = this.nextRequestId
    this.nextRequestId += 1
    return new Promise<WorkerMessage>((resolve, reject) => {
      const timeoutMs =
        message.type === 'init'
          ? inferenceTimeoutConfig.workerInitTimeoutMs
          : inferenceTimeoutConfig.workerDetectTimeoutMs
      const timeoutId = setTimeout(() => {
        const error = new Error('ONNX Worker 请求超时')
        this.requests.delete(requestId)
        reject(error)
        this.onFailure(error)
      }, timeoutMs)
      this.requests.set(requestId, { resolve, reject, timeoutId })
      try {
        this.worker.postMessage({ ...message, requestId }, transfer)
      } catch (error) {
        clearTimeout(timeoutId)
        this.requests.delete(requestId)
        const contextualError = new Error(`ONNX Worker 消息发送失败: ${formatErrorMessage(error)}`, { cause: error })
        this.onFailure(contextualError)
        reject(contextualError)
      }
    }).then((response) => {
      if (response.type === 'error') {
        throw new WorkerResponseError(response.message || 'ONNX Worker 错误', response.fatal === true)
      }
      return response
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
    if (message.type === 'error') {
      const error = new WorkerResponseError(
        typeof message.message === 'string' && message.message ? message.message : 'ONNX Worker 错误',
        message.fatal === true,
      )
      pending.reject(error)
      if (error.fatal) {
        this.onFailure(error)
      }
      return
    }
    if (message.type !== 'response') {
      const error = new WorkerResponseError('ONNX Worker 返回无效消息', true)
      pending.reject(error)
      this.onFailure(error)
      return
    }
    pending.resolve(message as WorkerMessage)
  }

  rejectPending(error: unknown): void {
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
    }
    this.requests.clear()
  }
}
