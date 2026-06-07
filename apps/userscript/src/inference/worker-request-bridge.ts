import { inferenceTimeoutConfig } from './inference-config'
import type { WorkerMessage, WorkerRequest, WorkerResponse } from './inference-types'

type PendingRequest = Readonly<{
  resolve: (message: WorkerMessage) => void
  reject: (error: unknown) => void
  timeoutId: ReturnType<typeof setTimeout>
}>

export class WorkerRequestBridge {
  private readonly requests = new Map<number, PendingRequest>()
  private nextRequestId = 1

  constructor(
    private readonly worker: Worker,
    private readonly onFailure: (error: unknown) => void,
  ) {
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handleMessage(event)
  }

  post(message: WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const requestId = this.nextRequestId
    this.nextRequestId += 1
    return new Promise<WorkerMessage>((resolve, reject) => {
      const timeoutMs = message.type === 'init'
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
        reject(error)
      }
    }).then((response) => {
      if (response.type === 'error') {
        throw new Error(response.message || 'ONNX Worker 错误')
      }
      return response
    })
  }

  handleMessage(event: MessageEvent<WorkerMessage>): void {
    const message = event.data || {}
    const requestId = message.requestId
    if (typeof requestId !== 'number' || !this.requests.has(requestId)) {
      return
    }
    const pending = this.requests.get(requestId)
    if (!pending) {
      return
    }
    this.requests.delete(requestId)
    clearTimeout(pending.timeoutId)
    if (message.type === 'error') {
      pending.reject(new Error(message.message || 'ONNX Worker 错误'))
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
