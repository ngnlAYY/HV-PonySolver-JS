import type { DetectorService, WorkerMessage, WorkerRequest, WorkerResponse, YoloParseResult } from './inference-types'
import { inferenceConfig } from './inference-config'
import { ModelCache } from '../model/model-cache'
import { createOnnxWorkerScript } from './onnx-worker-script'
import { parseYoloOutput } from './yolo-output-parser'
import type { StatusPanel } from '../status-panel/status-panel-types'

type PendingRequest = Readonly<{
  resolve: (message: WorkerMessage) => void
  reject: (error: unknown) => void
  timeoutId: ReturnType<typeof setTimeout>
}>

type OnnxWorkerClientOptions = Readonly<{
  bundledRuntimeSource?: string
}>

export class OnnxWorkerClient implements DetectorService {
  private worker: Worker | null = null
  private preparePromise: Promise<Worker> | null = null
  private readonly requests = new Map<number, PendingRequest>()
  private nextRequestId = 1
  private ready = false
  private destroyed = false

  constructor(
    private readonly modelCache: ModelCache,
    private readonly panel: StatusPanel,
    private readonly options: OnnxWorkerClientOptions = {},
  ) {}

  async prepare(): Promise<Worker> {
    if (this.destroyed) {
      throw new Error('Worker 已关闭')
    }
    if (this.worker && this.ready) {
      return this.worker
    }
    if (this.preparePromise) {
      return this.preparePromise
    }
    this.preparePromise = this.createWorker().catch((error) => {
      this.preparePromise = null
      this.ready = false
      this.panel.setStatus({ session: '错误' })
      throw error
    })
    return this.preparePromise
  }

  async detect(blob: Blob): Promise<YoloParseResult> {
    await this.prepare()
    this.panel.setStatus({ inference: '推理中' })
    try {
      const imageBuffer = await blob.arrayBuffer()
      const response = await this.post(
        { type: 'detect', imageBuffer, size: inferenceConfig.imageSize },
        [imageBuffer],
      )
      if (response.type !== 'response' || !(response.output instanceof ArrayBuffer)) {
        throw new Error('ONNX Worker 返回无效结果')
      }
      const detections = parseYoloOutput(new Float32Array(response.output))
      this.panel.setStatus({ inference: '完成' })
      return detections
    } catch (error) {
      this.panel.setStatus({ inference: '错误' })
      throw error
    }
  }

  destroy(): void {
    this.destroyed = true
    this.rejectPending(new Error('Worker 已关闭'))
    if (this.worker) {
      this.worker.terminate()
    }
    this.worker = null
    this.preparePromise = null
    this.ready = false
  }

  private async createWorker(): Promise<Worker> {
    if (this.destroyed) {
      throw new Error('Worker 已关闭')
    }
    const startedAt = Date.now()
    if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL !== 'function' || typeof URL.createObjectURL !== 'function') {
      throw new Error('当前环境不支持 Web Worker')
    }

    this.panel.setStatus({ session: '初始化中' })
    const cachedModel = await this.modelCache.getCached()
    const modelBuffer = cachedModel ?? await this.modelCache.download()
    const cacheBuffer = cachedModel ? null : modelBuffer.slice(0)
    const shouldCacheModel = cacheBuffer !== null
    if (this.destroyed) {
      throw new Error('Worker 已关闭')
    }
    const workerScript = createOnnxWorkerScript(this.options.bundledRuntimeSource)
    const workerBlob = new Blob([workerScript], { type: 'text/javascript' })
    const workerUrl = URL.createObjectURL(workerBlob)
    const worker = new Worker(workerUrl)
    URL.revokeObjectURL(workerUrl)

    this.worker = worker
    this.ready = false
    if (this.destroyed) {
      worker.terminate()
      if (this.worker === worker) {
        this.worker = null
      }
      throw new Error('Worker 已关闭')
    }
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handleMessage(event)
    worker.onerror = (event) => {
      this.failWorker(event.error || new Error(event.message || 'Worker 运行错误'))
    }
    worker.onmessageerror = () => {
      this.failWorker(new Error('Worker message 解析失败'))
    }

    try {
      if (this.destroyed) {
        throw new Error('Worker 已关闭')
      }
      await this.post(
        {
          type: 'init',
          ...(this.options.bundledRuntimeSource ? {} : { ortScriptUrl: inferenceConfig.ortScriptUrl }),
          wasmPath: inferenceConfig.ortWasmPath,
          modelBuffer,
        },
        [modelBuffer],
      )
      if (this.destroyed) {
        throw new Error('Worker 已关闭')
      }
      if (shouldCacheModel) {
        await this.modelCache.putCached(cacheBuffer)
      }
    } catch (error) {
      worker.terminate()
      if (this.worker === worker) {
        this.worker = null
      }
      this.ready = false
      if (this.destroyed) {
        throw new Error('Worker 已关闭')
      }
      throw error
    }

    this.ready = true
    this.preparePromise = null
    this.panel.setSessionReady(Date.now() - startedAt)
    return worker
  }

  private post(message: WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const worker = this.worker
    if (!worker) {
      return Promise.reject(new Error('ONNX Worker 尚未创建'))
    }
    const requestId = this.nextRequestId
    this.nextRequestId += 1
    return new Promise<WorkerMessage>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.failWorker(new Error('ONNX Worker 请求超时'))
      }, inferenceConfig.workerRequestTimeoutMs)
      this.requests.set(requestId, { resolve, reject, timeoutId })
      try {
        worker.postMessage({ ...message, requestId }, transfer)
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

  private handleMessage(event: MessageEvent<WorkerMessage>): void {
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

  private failWorker(error: unknown): void {
    this.rejectPending(error)
    if (this.worker) {
      this.worker.terminate()
    }
    this.worker = null
    this.preparePromise = null
    this.ready = false
    this.panel.setStatus({ session: '错误' })
  }

  private rejectPending(error: unknown): void {
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
    }
    this.requests.clear()
  }
}
