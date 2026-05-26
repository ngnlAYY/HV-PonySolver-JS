import type { DetectorService, WorkerMessage, WorkerRequest, WorkerResponse, YoloParseResult } from './inference-types'
import { inferenceConfig } from './inference-config'
import { ModelCache } from '../model/model-cache'
import { createOnnxWorkerScript } from './onnx-worker-script'
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
  private detectQueue = Promise.resolve()
  private nextRequestId = 1
  private ready = false
  private destroyed = false
  private prepareAbortController: AbortController | null = null

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

  detect(blob: Blob): Promise<YoloParseResult> {
    const detectPromise = this.detectQueue.then(() => this.runDetect(blob))
    this.detectQueue = detectPromise.then(() => undefined, () => undefined)
    return detectPromise
  }

  private async runDetect(blob: Blob): Promise<YoloParseResult> {
    await this.prepare()
    this.panel.setStatus({ inference: '推理中' })
    try {
      const response = await this.post({ type: 'detect', imageBlob: blob, size: inferenceConfig.imageSize })
      if (response.type !== 'response' || !response.result) {
        throw new Error('ONNX Worker 返回无效结果')
      }
      this.panel.setStatus({ inference: '完成' })
      return response.result
    } catch (error) {
      this.panel.setStatus({ inference: '错误' })
      throw error
    }
  }

  destroy(): void {
    this.destroyed = true
    this.prepareAbortController?.abort()
    this.prepareAbortController = null
    this.rejectPending(new Error('Worker 已关闭'))
    if (this.worker) {
      this.worker.terminate()
    }
    this.worker = null
    this.preparePromise = null
    this.ready = false
  }

  private async createWorker(): Promise<Worker> {
    const startedAt = Date.now()
    const abortController = new AbortController()
    this.prepareAbortController = abortController
    this.panel.setStatus({ session: '初始化中' })

    try {
      this.checkAbort(abortController)
      const { modelBuffer, cacheBuffer } = await this.loadModelBuffer(abortController)
      this.checkAbort(abortController)
      const worker = this.spawnWorker()
      this.worker = worker
      this.ready = false
      await this.initWorkerSession(worker, abortController, modelBuffer)
      this.checkAbort(abortController)
      if (cacheBuffer) {
        await this.modelCache.putCached(cacheBuffer)
      }
      this.checkAbort(abortController)
      this.ready = true
      this.preparePromise = null
      this.clearPrepareAbortController(abortController)
      this.panel.setSessionReady(Date.now() - startedAt)
      return worker
    } catch (error) {
      this.clearPrepareAbortController(abortController)
      if (this.destroyed || abortController.signal.aborted) {
        throw new Error('Worker 已关闭')
      }
      throw error
    }
  }

  private checkAbort(abortController: AbortController): void {
    if (this.destroyed || abortController.signal.aborted) {
      this.worker?.terminate()
      this.worker = null
      throw new Error('Worker 已关闭')
    }
  }

  private async loadModelBuffer(abortController: AbortController): Promise<{ modelBuffer: ArrayBuffer, cacheBuffer: ArrayBuffer | null }> {
    const cachedModel = await this.modelCache.getCached()
    const modelBuffer = cachedModel ?? await this.modelCache.download(abortController.signal)
    return {
      modelBuffer,
      cacheBuffer: cachedModel ? null : modelBuffer.slice(0),
    }
  }

  private spawnWorker(): Worker {
    if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL !== 'function' || typeof URL.createObjectURL !== 'function') {
      throw new Error('当前环境不支持 Web Worker')
    }

    const workerScript = createOnnxWorkerScript(this.options.bundledRuntimeSource)
    const workerBlob = new Blob([workerScript], { type: 'text/javascript' })
    const workerUrl = URL.createObjectURL(workerBlob)
    let worker: Worker
    try {
      worker = new Worker(workerUrl)
    } finally {
      URL.revokeObjectURL(workerUrl)
    }
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handleMessage(event)
    worker.onerror = (event) => this.failWorker(event.error || new Error(event.message || 'Worker 运行错误'))
    worker.onmessageerror = () => this.failWorker(new Error('Worker message 解析失败'))
    return worker
  }

  private async initWorkerSession(worker: Worker, abortController: AbortController, modelBuffer: ArrayBuffer): Promise<void> {
    try {
      this.checkAbort(abortController)
      await this.post(
        {
          type: 'init',
          ...(this.options.bundledRuntimeSource ? {} : { ortScriptUrl: inferenceConfig.ortScriptUrl }),
          wasmPath: inferenceConfig.ortWasmPath,
          modelBuffer,
        },
        [modelBuffer],
      )
    } catch (error) {
      worker.terminate()
      if (this.worker === worker) {
        this.worker = null
      }
      this.ready = false
      throw error
    }
  }

  private clearPrepareAbortController(abortController: AbortController): void {
    if (this.prepareAbortController === abortController) {
      this.prepareAbortController = null
    }
  }

  private post(message: WorkerRequest, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const worker = this.worker
    if (!worker) {
      return Promise.reject(new Error('ONNX Worker 尚未创建'))
    }
    const requestId = this.nextRequestId
    this.nextRequestId += 1
    return new Promise<WorkerMessage>((resolve, reject) => {
      const timeoutMs = message.type === 'init'
        ? inferenceConfig.workerInitTimeoutMs
        : inferenceConfig.workerDetectTimeoutMs
      const timeoutId = setTimeout(() => {
        this.failWorker(new Error('ONNX Worker 请求超时'))
      }, timeoutMs)
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
