import type { DetectorService, WorkerRequest, WorkerResponse, YoloParseResult } from './inference-types'
import { createBlobWorker } from './blob-worker'
import { imagePreprocessConfig, onnxRuntimeConfig } from './inference-config'
import { ModelCache } from '../model/model-cache'
import { createOnnxWorkerScript } from './onnx-worker-script'
import { WorkerRequestBridge } from './worker-request-bridge'
import type { InferenceStatusSink } from '../status-panel/status-panel-types'

type OnnxWorkerClientOptions = Readonly<{
  bundledRuntimeSource?: string
}>

export class OnnxWorkerClient implements DetectorService {
  private worker: Worker | null = null
  private requestBridge: WorkerRequestBridge | null = null
  private preparePromise: Promise<Worker> | null = null
  private detectQueue = Promise.resolve()
  private ready = false
  private destroyed = false
  private prepareAbortController: AbortController | null = null

  constructor(
    private readonly modelCache: ModelCache,
    private readonly panel: InferenceStatusSink,
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
    this.detectQueue = detectPromise.then(
      () => undefined,
      () => undefined,
    )
    return detectPromise
  }

  private async runDetect(blob: Blob): Promise<YoloParseResult> {
    await this.prepare()
    const startedAt = Date.now()
    this.panel.setStatus({ inference: '推理中' })
    try {
      const response = await this.post({ type: 'detect', imageBlob: blob, size: imagePreprocessConfig.imageSize })
      if (response.type !== 'response' || !response.result) {
        throw new Error('ONNX Worker 返回无效结果')
      }
      this.panel.setStatus({ inference: `完成 ${Date.now() - startedAt}ms` })
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
        await this.modelCache.putCached(cacheBuffer, true, true)
      }
      this.checkAbort(abortController)
      this.ready = true
      this.preparePromise = null
      this.clearPrepareAbortController(abortController)
      this.panel.setSessionReady(Date.now() - startedAt)
      return worker
    } catch (error) {
      this.worker?.terminate()
      this.worker = null
      this.ready = false
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

  private async loadModelBuffer(
    abortController: AbortController,
  ): Promise<{ modelBuffer: ArrayBuffer; cacheBuffer: ArrayBuffer | null }> {
    const cachedModel = await this.modelCache.getCached()
    const modelBuffer = cachedModel ?? (await this.modelCache.download(abortController.signal))
    return {
      modelBuffer,
      cacheBuffer: cachedModel ? null : modelBuffer.slice(0),
    }
  }

  private spawnWorker(): Worker {
    const workerScript = createOnnxWorkerScript(this.options.bundledRuntimeSource)
    const worker = createBlobWorker(workerScript)
    this.requestBridge = new WorkerRequestBridge(worker, (error) => this.failWorker(error))
    worker.onerror = (event) => this.failWorker(event.error || new Error(event.message || 'Worker 运行错误'))
    worker.onmessageerror = () => this.failWorker(new Error('Worker message 解析失败'))
    return worker
  }

  private async initWorkerSession(
    worker: Worker,
    abortController: AbortController,
    modelBuffer: ArrayBuffer,
  ): Promise<void> {
    try {
      this.checkAbort(abortController)
      await this.post(
        {
          type: 'init',
          ...(this.options.bundledRuntimeSource ? {} : { ortScriptUrl: onnxRuntimeConfig.ortScriptUrl }),
          wasmPath: onnxRuntimeConfig.ortWasmPath,
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
    if (!this.requestBridge) {
      return Promise.reject(new Error('ONNX Worker 尚未创建'))
    }
    return this.requestBridge.post(message, transfer)
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
    this.requestBridge?.rejectPending(error)
    this.requestBridge = null
  }
}
