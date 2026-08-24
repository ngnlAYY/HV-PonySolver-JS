import type { VerifiedModelDetectorService, YoloParseResult } from './inference-types'
import { inferenceRecoveryConfig, inferenceTimeoutConfig } from './inference-config'
import { WorkerRequestBridge, WorkerRequestTimeoutError } from './worker-request-bridge'
import type { InferenceStatusSink } from '../status-panel/status-panel-types'
import { raceAbort } from '../utils/abort-race'

export interface ModelRepository {
  getCached(signal?: AbortSignal, deadline?: number): Promise<ArrayBuffer | null>
  download(signal?: AbortSignal, verifyIntegrity?: boolean, accessKeyOverride?: string): Promise<ArrayBuffer>
  putCached(
    buffer: ArrayBuffer,
    verifyIntegrity?: boolean,
    skipIntegrityVerification?: boolean,
    signal?: AbortSignal,
  ): Promise<void>
}

export type WorkerFactory = () => Worker

type PreparationSource =
  Readonly<{ type: 'repository' }> | Readonly<{ type: 'verified-buffer'; modelBuffer: ArrayBuffer }>

type PreparationOperation = {
  readonly controller: AbortController
  /** The first caller decides whether the whole preparation stays off-panel. */
  readonly silent: boolean
  promise: Promise<void>
  owners: number
  settled: boolean
  readonly timeoutId: ReturnType<typeof setTimeout>
}

class PreparationCancelledError extends Error {
  constructor() {
    super('推理请求已取消')
    this.name = 'PreparationCancelledError'
  }
}

function signalError(signal: AbortSignal, fallback: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(fallback)
}

export class OnnxWorkerClient implements VerifiedModelDetectorService {
  private worker: Worker | null = null
  private requestBridge: WorkerRequestBridge | null = null
  private preparation: PreparationOperation | null = null
  private detectQueue = Promise.resolve()
  private ready = false
  private destroyed = false
  private consecutiveDetectErrors = 0
  private readonly destroyController = new AbortController()

  constructor(
    private readonly modelCache: ModelRepository,
    private readonly panel: InferenceStatusSink,
    private readonly workerFactory: WorkerFactory,
  ) {}

  async prepare(signal?: AbortSignal, options?: Readonly<{ silent?: boolean }>): Promise<void> {
    this.assertRequestActive(signal)
    if (this.worker && this.ready) {
      return
    }
    const operation = this.preparation ?? this.startPreparation({ type: 'repository' }, options?.silent === true)
    return this.joinPreparation(operation, signal)
  }

  async prepareFromVerifiedModel(
    modelBuffer: ArrayBuffer,
    signal?: AbortSignal,
    options?: Readonly<{ silent?: boolean }>,
  ): Promise<void> {
    this.assertRequestActive(signal)
    if (this.worker && this.ready) {
      await this.cacheVerifiedBufferBestEffort(modelBuffer, signal)
      this.assertRequestActive(signal)
      return
    }

    const existingPreparation = this.preparation
    if (existingPreparation) {
      try {
        await this.joinPreparation(existingPreparation, signal)
        this.assertRequestActive(signal)
        await this.cacheVerifiedBufferBestEffort(modelBuffer, signal)
        this.assertRequestActive(signal)
        return
      } catch (error) {
        this.assertRequestActive(signal)
        if (this.preparation || this.ready) {
          throw error
        }
        // The already-running source failed. The verified caller-owned buffer
        // is still intact, so retry once without routing it through IndexedDB.
      }
    }

    const operation = this.startPreparation({ type: 'verified-buffer', modelBuffer }, options?.silent === true)
    return this.joinPreparation(operation, signal)
  }

  detect(blob: Blob, signal?: AbortSignal): Promise<YoloParseResult> {
    if (signal?.aborted) {
      return Promise.reject(new Error('推理请求已取消'))
    }
    let workerPosted = false
    const detectPromise = this.detectQueue.then(() =>
      this.runDetect(blob, signal, () => {
        workerPosted = true
      }),
    )
    this.detectQueue = detectPromise.then(
      () => undefined,
      () => undefined,
    )
    return raceAbort(detectPromise, signal, () => new Error('推理请求已取消'), {
      holdOnAbort: () => workerPosted,
    })
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    const closedError = new Error('Worker 已关闭')
    this.destroyController.abort(closedError)
    this.preparation?.controller.abort(closedError)
    this.rejectPending(closedError)
    this.worker?.terminate()
    this.worker = null
    this.ready = false
    this.consecutiveDetectErrors = 0
  }

  private startPreparation(source: PreparationSource, silent: boolean = false): PreparationOperation {
    const controller = new AbortController()
    const operation: PreparationOperation = {
      controller,
      silent,
      promise: Promise.resolve(),
      owners: 0,
      settled: false,
      timeoutId: setTimeout(() => {
        controller.abort(new Error('ONNX Worker 初始化超时'))
      }, inferenceTimeoutConfig.workerPrepareTimeoutMs),
    }
    this.preparation = operation
    operation.promise = this.createWorker(controller, source, silent)
      .catch((error: unknown) => {
        this.ready = false
        const preparationReason = controller.signal.reason
        if (!silent && !this.destroyed && !(preparationReason instanceof PreparationCancelledError)) {
          this.panel.setStatus({ session: '错误' })
        }
        throw error
      })
      .finally(() => {
        operation.settled = true
        clearTimeout(operation.timeoutId)
        if (this.preparation === operation) {
          this.preparation = null
        }
      })
    return operation
  }

  private joinPreparation(operation: PreparationOperation, signal?: AbortSignal): Promise<void> {
    this.assertRequestActive(signal)
    operation.owners += 1
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const release = (): void => {
        operation.owners -= 1
        if (
          operation.owners === 0 &&
          !operation.settled &&
          this.preparation === operation &&
          !operation.controller.signal.aborted
        ) {
          operation.controller.abort(new PreparationCancelledError())
        }
      }
      const cleanup = (): void => signal?.removeEventListener('abort', onAbort)
      const finish = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        release()
        callback()
      }
      const onAbort = (): void => finish(() => reject(new Error('推理请求已取消')))
      signal?.addEventListener('abort', onAbort, { once: true })
      operation.promise.then(
        () => finish(resolve),
        (error: unknown) => finish(() => reject(error)),
      )
      if (signal?.aborted) {
        onAbort()
      }
    })
  }

  private async runDetect(
    blob: Blob,
    signal: AbortSignal | undefined,
    onWorkerPosted: () => void,
  ): Promise<YoloParseResult> {
    this.assertRequestActive(signal)
    await this.prepare(signal)
    this.assertRequestActive(signal)
    const startedAt = Date.now()
    this.panel.setStatus({ inference: '推理中' })
    try {
      const worker = this.worker
      const bridge = this.requestBridge
      if (!worker || !bridge || !this.ready) {
        throw new Error('ONNX Worker 尚未准备完成')
      }
      this.assertRequestActive(signal)
      onWorkerPosted()
      const response = await this.waitForRunningAbortRecovery(
        bridge.post({ type: 'detect', imageBlob: blob }),
        signal,
        worker,
        bridge,
      )
      this.assertRequestActive(signal)
      if (response.type !== 'response' || !response.result) {
        const error = new Error('ONNX Worker 返回无效结果')
        this.failWorker(error, worker, bridge)
        throw error
      }
      this.consecutiveDetectErrors = 0
      this.panel.setStatus({ inference: `完成 ${Date.now() - startedAt}ms` })
      return response.result
    } catch (error) {
      if (!signal?.aborted && !this.destroyed) {
        this.panel.setStatus({ inference: '错误' })
        this.recordDetectFailure(error)
      }
      throw error
    }
  }

  private recordDetectFailure(error: unknown): void {
    const worker = this.worker
    const bridge = this.requestBridge
    if (!worker || !bridge) {
      return
    }
    this.consecutiveDetectErrors += 1
    if (this.consecutiveDetectErrors >= inferenceRecoveryConfig.maxConsecutiveWorkerErrors) {
      this.failWorker(error, worker, bridge)
    }
  }

  private async createWorker(
    controller: AbortController,
    source: PreparationSource,
    silent: boolean = false,
  ): Promise<void> {
    // Repeated timeouts mean the environment cannot finish a session; rebuilding
    // forever would loop the download quota and CPU without ever recovering.
    if (this.consecutiveDetectErrors >= inferenceRecoveryConfig.maxConsecutiveWorkerErrors) {
      throw new Error('ONNX Worker 连续多次请求超时，已停止自动重建')
    }
    const startedAt = Date.now()
    if (!silent) {
      this.panel.setStatus({ session: '初始化中' })
    }
    let createdWorker: Worker | null = null
    let createdBridge: WorkerRequestBridge | null = null

    try {
      this.checkPreparation(controller)
      const { modelBuffer, cacheBuffer } = await this.loadModelBuffer(controller, source)
      this.checkPreparation(controller)
      const worker = this.spawnWorker()
      const bridge = this.requestBridge
      if (!bridge) {
        throw new Error('ONNX Worker 请求桥创建失败')
      }
      createdWorker = worker
      createdBridge = bridge
      this.ready = false
      await this.initWorkerSession(worker, bridge, controller, modelBuffer)
      this.checkPreparation(controller, worker, bridge)
      if (cacheBuffer) {
        await this.cacheVerifiedBufferBestEffort(cacheBuffer, controller.signal)
      }
      this.checkPreparation(controller, worker, bridge)
      this.ready = true
      // Only a completed detect proves the session actually answers on this
      // device, so the consecutive-timeout count survives a successful init.
      if (!silent) {
        this.panel.setSessionReady(Date.now() - startedAt)
      }
    } catch (error) {
      if (createdWorker && createdBridge && this.worker === createdWorker && this.requestBridge === createdBridge) {
        this.discardWorker(createdWorker, createdBridge, error)
      }
      this.ready = false
      if (controller.signal.aborted) {
        throw signalError(controller.signal, 'Worker 初始化已取消')
      }
      if (this.destroyed) {
        throw new Error('Worker 已关闭', { cause: error })
      }
      throw error
    }
  }

  private checkPreparation(
    controller: AbortController,
    expectedWorker?: Worker,
    expectedBridge?: WorkerRequestBridge,
  ): void {
    if (this.destroyed || this.destroyController.signal.aborted) {
      throw new Error('Worker 已关闭')
    }
    if (controller.signal.aborted) {
      throw signalError(controller.signal, 'Worker 初始化已取消')
    }
    if (expectedWorker && expectedBridge && (this.worker !== expectedWorker || this.requestBridge !== expectedBridge)) {
      throw new Error('ONNX Worker 初始化期间已失效')
    }
  }

  private async loadModelBuffer(
    controller: AbortController,
    source: PreparationSource,
  ): Promise<{ modelBuffer: ArrayBuffer; cacheBuffer: ArrayBuffer | null }> {
    if (source.type === 'verified-buffer') {
      return {
        modelBuffer: source.modelBuffer,
        cacheBuffer: source.modelBuffer.slice(0),
      }
    }

    const cachedModel = await raceAbort(
      this.modelCache.getCached(controller.signal, Date.now() + inferenceTimeoutConfig.modelCacheTimeoutMs),
      controller.signal,
      () => signalError(controller.signal, '操作已取消'),
    )
    this.checkPreparation(controller)
    const modelBuffer =
      cachedModel ??
      (await raceAbort(this.modelCache.download(controller.signal), controller.signal, () =>
        signalError(controller.signal, '操作已取消'),
      ))
    return {
      modelBuffer,
      cacheBuffer: cachedModel ? null : modelBuffer.slice(0),
    }
  }

  private spawnWorker(): Worker {
    const worker = this.workerFactory()
    const requestBridge = new WorkerRequestBridge(worker, (error) => this.failWorker(error, worker, requestBridge))
    this.worker = worker
    this.requestBridge = requestBridge
    worker.onerror = (event) =>
      this.failWorker(event.error || new Error(event.message || 'Worker 运行错误'), worker, requestBridge)
    worker.onmessageerror = () => this.failWorker(new Error('Worker message 解析失败'), worker, requestBridge)
    return worker
  }

  private async initWorkerSession(
    worker: Worker,
    bridge: WorkerRequestBridge,
    controller: AbortController,
    modelBuffer: ArrayBuffer,
  ): Promise<void> {
    this.checkPreparation(controller, worker, bridge)
    await raceAbort(
      bridge.post(
        {
          type: 'init',
          modelBuffer,
        },
        [modelBuffer],
      ),
      controller.signal,
      () => signalError(controller.signal, '操作已取消'),
    )
  }

  private async cacheVerifiedBufferBestEffort(buffer: ArrayBuffer, parentSignal?: AbortSignal): Promise<void> {
    const controller = new AbortController()
    const abortFromParent = (): void => controller.abort(signalError(parentSignal!, '推理请求已取消'))
    const abortFromDestroy = (): void => controller.abort(new Error('Worker 已关闭'))
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    this.destroyController.signal.addEventListener('abort', abortFromDestroy, { once: true })
    const timeoutId = setTimeout(() => {
      controller.abort(new Error('模型缓存写入超时'))
    }, inferenceTimeoutConfig.modelCacheTimeoutMs)
    if (parentSignal?.aborted) {
      abortFromParent()
    } else if (this.destroyController.signal.aborted) {
      abortFromDestroy()
    }

    try {
      await raceAbort(this.modelCache.putCached(buffer, true, true, controller.signal), controller.signal, () =>
        signalError(controller.signal, '操作已取消'),
      )
    } catch {
      if (this.destroyed || this.destroyController.signal.aborted) {
        throw new Error('Worker 已关闭')
      }
      if (parentSignal?.aborted) {
        throw new Error('推理请求已取消')
      }
      // Cache persistence is best-effort after the Worker accepted the model.
    } finally {
      clearTimeout(timeoutId)
      parentSignal?.removeEventListener('abort', abortFromParent)
      this.destroyController.signal.removeEventListener('abort', abortFromDestroy)
    }
  }

  private discardWorker(worker: Worker, bridge: WorkerRequestBridge, error: unknown): void {
    bridge.rejectPending(error)
    worker.terminate()
    if (this.worker === worker && this.requestBridge === bridge) {
      this.worker = null
      this.requestBridge = null
      this.ready = false
    }
  }

  private failWorker(
    error: unknown,
    sourceWorker: Worker,
    sourceBridge: WorkerRequestBridge,
    reportSessionError: boolean = true,
  ): void {
    if (sourceWorker !== this.worker || sourceBridge !== this.requestBridge) {
      return
    }
    sourceBridge.rejectPending(error)
    sourceWorker.terminate()
    this.worker = null
    this.requestBridge = null
    this.ready = false
    if (error instanceof WorkerRequestTimeoutError) {
      // The wedged session is gone, but the timeout still counts toward the
      // recovery limit so a slow device stops rebuilding after repeated stalls.
      this.consecutiveDetectErrors += 1
    } else {
      this.consecutiveDetectErrors = 0
    }
    if (reportSessionError && !this.destroyed) {
      this.panel.setStatus({ session: '错误' })
    }
  }

  private rejectPending(error: unknown): void {
    this.requestBridge?.rejectPending(error)
    this.requestBridge = null
  }

  private assertRequestActive(signal?: AbortSignal): void {
    if (this.destroyed) {
      throw new Error('Worker 已关闭')
    }
    if (signal?.aborted) {
      throw new Error('推理请求已取消')
    }
  }

  private waitForRunningAbortRecovery<T>(
    promise: Promise<T>,
    signal: AbortSignal | undefined,
    worker: Worker,
    bridge: WorkerRequestBridge,
  ): Promise<T> {
    if (!signal) {
      return promise
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const onAbort = (): void => {
      timeoutId ??= setTimeout(() => {
        this.failWorker(new Error('推理请求已取消'), worker, bridge, false)
      }, inferenceTimeoutConfig.workerAbortGraceTimeoutMs)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
    return promise.finally(() => {
      signal.removeEventListener('abort', onAbort)
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
    })
  }
}
