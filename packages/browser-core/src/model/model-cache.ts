import type { CacheStatusSink } from '../status-panel/status-panel-types'
import { inferenceTimeoutConfig } from '../inference/inference-config'
import { raceAbort } from '../utils/abort-race'
import { formatErrorMessage } from '../utils/errors'
import { isRecordObject } from '../utils/guards'
import { warn } from '../utils/logger'
import { modelConfig } from './model-config'
import { confirmCachedModelDownload, downloadModel } from './model-downloader'
import type { ModelIntegrityOptions } from './model-integrity'
import { resolveIntegrityOptions, verifyModelIntegrity } from './model-integrity'

const MODEL_STORE_NAME = 'models'

type CacheOperationContext = Readonly<{
  generation: number
  signal?: AbortSignal
  lifecycleSignal: AbortSignal
  deadline: number
}>

type OpenAttempt = {
  readonly promise: Promise<IDBDatabase>
  readonly cancel: (error: Error) => void
  owners: number
  settled: boolean
}

type SharedDownload = {
  readonly controller: AbortController
  readonly promise: Promise<ArrayBuffer>
  owners: number
  settled: boolean
}

class ModelCacheLifecycleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelCacheLifecycleError'
  }
}

export async function createCachedModelRow(
  buffer: ArrayBuffer,
  options: ModelIntegrityOptions = {},
): Promise<Record<string, unknown>> {
  const { integrity, verifyIntegrity } = resolveIntegrityOptions(options)
  if (verifyIntegrity) {
    await verifyModelIntegrity(buffer, integrity, '缓存写入模型')
  }
  return {
    key: modelConfig.cacheKey,
    version: modelConfig.version,
    byteLength: integrity.byteLength,
    sha256: integrity.sha256,
    buffer,
    updatedAt: Date.now(),
  }
}

export async function readCachedModelBuffer(
  row: unknown,
  options: ModelIntegrityOptions = {},
): Promise<ArrayBuffer | null> {
  const { integrity, verifyIntegrity } = resolveIntegrityOptions(options)
  if (!isRecordObject(row) || row.version !== modelConfig.version || !(row.buffer instanceof ArrayBuffer)) {
    return null
  }
  if (!verifyIntegrity) {
    return row.buffer
  }
  if (row.byteLength !== integrity.byteLength || row.sha256 !== integrity.sha256) {
    return null
  }
  try {
    await verifyModelIntegrity(row.buffer, integrity, '缓存模型')
    return row.buffer
  } catch {
    return null
  }
}

export class ModelCache {
  private db: IDBDatabase | null = null
  private openAttempt: OpenAttempt | null = null
  private generation = 0
  private lifecycleController = new AbortController()
  private readonly activeTransactionAborts = new Set<() => void>()
  private readonly activeDownloads = new Map<string, SharedDownload>()

  constructor(
    private readonly statusSink: CacheStatusSink,
    private readonly downloadModelImpl: typeof downloadModel = downloadModel,
  ) {}

  async getCached(
    signal?: AbortSignal,
    deadline: number = Date.now() + inferenceTimeoutConfig.modelCacheTimeoutMs,
  ): Promise<ArrayBuffer | null> {
    const context = this.createOperationContext(signal, deadline)
    const startedAt = Date.now()
    this.statusSink.setStatus({ model: '确认缓存中' })
    try {
      this.assertOperationActive(context)
      const cached = await this.readCached(context)
      this.assertOperationActive(context)
      const elapsed = Date.now() - startedAt
      if (cached) {
        this.statusSink.setStatus({ model: `缓存命中 ${elapsed}ms` })
        return cached
      }
      this.statusSink.setStatus({ model: `缓存未命中 ${elapsed}ms` })
    } catch (error) {
      // A lifecycle cancellation (close/abort) must surface to the caller:
      // swallowing it here would read as a cache miss and trigger a real,
      // quota-metered download for an operation that was already abandoned.
      if (error instanceof ModelCacheLifecycleError) {
        throw error
      }
      const elapsed = Date.now() - startedAt
      this.statusSink.setStatus({ model: `缓存读取失败 ${elapsed}ms，准备下载` })
      warn('读取模型缓存失败，改为下载模型:', formatErrorMessage(error))
    }
    return null
  }

  async download(
    signal?: AbortSignal,
    verifyIntegrity: boolean = modelConfig.verifyIntegrity,
    accessKeyOverride?: string,
  ): Promise<ArrayBuffer> {
    if (signal?.aborted) {
      throw new Error('模型缓存操作已取消')
    }
    const startedAt = Date.now()
    const lifecycleSignal = this.lifecycleController.signal
    this.statusSink.setStatus({ model: '下载中' })
    // Concurrent callers share one in-flight download so a single monthly-quota
    // GET serves all of them; each caller still honors its own abort signal.
    const downloadKey = `${verifyIntegrity ? 'verified' : 'unverified'}:${accessKeyOverride ?? ''}`
    let shared = this.activeDownloads.get(downloadKey)
    if (!shared) {
      const options: ModelIntegrityOptions =
        accessKeyOverride === undefined ? { verifyIntegrity } : { accessKeyOverride, verifyIntegrity }
      shared = this.createSharedDownload(downloadKey, options)
      this.activeDownloads.set(downloadKey, shared)
    }
    shared.owners += 1
    try {
      const signals = signal ? [signal, lifecycleSignal] : [lifecycleSignal]
      const buffer = await raceAbort(shared.promise, signals, () => new ModelCacheLifecycleError('模型缓存操作已取消'))
      if (signal?.aborted || lifecycleSignal.aborted || lifecycleSignal !== this.lifecycleController.signal) {
        throw new ModelCacheLifecycleError('模型缓存操作已取消')
      }
      this.statusSink.setStatus({ model: `下载完成 ${Date.now() - startedAt}ms` })
      return buffer
    } finally {
      shared.owners -= 1
      if (shared.owners === 0 && !shared.settled && this.activeDownloads.get(downloadKey) === shared) {
        this.activeDownloads.delete(downloadKey)
        shared.controller.abort(new ModelCacheLifecycleError('模型缓存操作已取消'))
      }
    }
  }

  async putCached(
    buffer: ArrayBuffer,
    verifyIntegrity: boolean = modelConfig.verifyIntegrity,
    skipIntegrityVerification: boolean = false,
    signal?: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now()
    const context = this.createOperationContext(signal, Date.now() + inferenceTimeoutConfig.modelCacheTimeoutMs)
    try {
      this.assertOperationActive(context)
      await this.writeCached(buffer, verifyIntegrity, skipIntegrityVerification, context)
      this.assertOperationActive(context)
      await this.waitForOperation(confirmCachedModelDownload(buffer, context.signal), context, '模型下载缓存确认超时')
      this.assertOperationActive(context)
      this.statusSink.setStatus({ model: `已缓存 ${Date.now() - startedAt}ms` })
    } catch (error) {
      warn('模型缓存或下载次数确认失败，继续使用已下载模型:', formatErrorMessage(error))
      if (verifyIntegrity || error instanceof ModelCacheLifecycleError) {
        throw error
      }
    }
  }

  close(): void {
    this.generation += 1
    const closedError = new ModelCacheLifecycleError('模型缓存操作已取消')
    const lifecycleController = this.lifecycleController
    this.lifecycleController = new AbortController()
    this.openAttempt?.cancel(closedError)
    this.openAttempt = null
    for (const abort of [...this.activeTransactionAborts]) {
      abort()
    }
    this.activeTransactionAborts.clear()
    for (const shared of this.activeDownloads.values()) {
      shared.controller.abort(closedError)
    }
    this.activeDownloads.clear()
    this.db?.close()
    this.db = null
    lifecycleController.abort(closedError)
  }

  private createSharedDownload(downloadKey: string, options: ModelIntegrityOptions): SharedDownload {
    const controller = new AbortController()
    const promise = Promise.resolve()
      .then(() => this.downloadModelImpl(controller.signal, options))
      .finally(() => {
        const active = this.activeDownloads.get(downloadKey)
        if (active?.controller === controller) {
          active.settled = true
          this.activeDownloads.delete(downloadKey)
        }
      })
    return { controller, promise, owners: 0, settled: false }
  }

  private createOperationContext(signal: AbortSignal | undefined, deadline: number): CacheOperationContext {
    return {
      generation: this.generation,
      ...(signal ? { signal } : {}),
      lifecycleSignal: this.lifecycleController.signal,
      deadline,
    }
  }

  private async open(context: CacheOperationContext): Promise<IDBDatabase> {
    this.assertOperationActive(context)
    if (this.db) {
      return this.db
    }
    const attempt = this.openAttempt ?? this.createOpenAttempt(context.generation)
    attempt.owners += 1
    try {
      const database = await this.waitForOperation(attempt.promise, context, 'IndexedDB 打开超时')
      this.assertOperationActive(context)
      return database
    } finally {
      attempt.owners -= 1
      if (attempt.owners === 0 && !attempt.settled && this.openAttempt === attempt) {
        attempt.cancel(new Error('IndexedDB 打开已取消'))
      }
    }
  }

  private createOpenAttempt(generation: number): OpenAttempt {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(modelConfig.cacheName, 1)
    } catch (error) {
      return {
        promise: Promise.reject(error),
        cancel: () => undefined,
        owners: 0,
        settled: true,
      }
    }

    let resolvePromise!: (database: IDBDatabase) => void
    let rejectPromise!: (error: unknown) => void
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    const cleanup = (): void => {
      clearTimeout(timeoutId)
      if (this.openAttempt === attempt) {
        this.openAttempt = null
      }
    }
    const resolve = (database: IDBDatabase): void => {
      if (attempt.settled) {
        database.close()
        return
      }
      attempt.settled = true
      cleanup()
      resolvePromise(database)
    }
    const reject = (error: unknown): void => {
      if (attempt.settled) {
        return
      }
      attempt.settled = true
      cleanup()
      rejectPromise(error)
    }
    const attempt: OpenAttempt = {
      promise,
      cancel: reject,
      owners: 0,
      settled: false,
    }
    this.openAttempt = attempt
    const timeoutId = setTimeout(() => {
      reject(new Error('IndexedDB 打开超时'))
    }, inferenceTimeoutConfig.modelCacheTimeoutMs)

    request.onupgradeneeded = () => {
      // IndexedDB upgrades cannot be cancelled. Finish creating the schema even
      // when the waiting caller has left, then close a late successful database.
      if (!request.result.objectStoreNames?.contains?.(MODEL_STORE_NAME)) {
        request.result.createObjectStore(MODEL_STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      if (attempt.settled || generation !== this.generation || this.openAttempt !== attempt) {
        database.close()
        reject(new ModelCacheLifecycleError('模型缓存操作已取消'))
        return
      }
      this.db = database
      database.onversionchange = () => {
        if (this.db === database) {
          this.close()
        } else {
          database.close()
        }
      }
      resolve(database)
    }
    request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'))
    request.onblocked = () => reject(new Error('IndexedDB 打开被阻止'))
    return attempt
  }

  private async readCached(context: CacheOperationContext): Promise<ArrayBuffer | null> {
    const db = await this.open(context)
    this.assertOperationActive(context)
    const transaction = db.transaction(MODEL_STORE_NAME, 'readonly')
    const request = transaction.objectStore(MODEL_STORE_NAME).get(modelConfig.cacheKey)
    const row = await this.transactionResult(transaction, request, context, '模型缓存读取超时')
    this.assertOperationActive(context)
    return this.waitForOperation(readCachedModelBuffer(row), context, '模型缓存完整性校验超时')
  }

  private async writeCached(
    buffer: ArrayBuffer,
    verifyIntegrity: boolean,
    skipIntegrityVerification: boolean,
    context: CacheOperationContext,
  ): Promise<void> {
    this.assertOperationActive(context)
    const row = await this.waitForOperation(
      createCachedModelRow(buffer, {
        verifyIntegrity: skipIntegrityVerification ? false : verifyIntegrity,
      }),
      context,
      '模型缓存完整性校验超时',
    )
    this.assertOperationActive(context)
    const db = await this.open(context)
    this.assertOperationActive(context)
    const transaction = db.transaction(MODEL_STORE_NAME, 'readwrite')
    try {
      transaction.objectStore(MODEL_STORE_NAME).put(row)
    } catch (error) {
      try {
        transaction.abort()
      } catch {
        // Preserve the object-store failure.
      }
      throw error
    }
    await this.transactionResult(transaction, null, context, '模型缓存写入超时')
  }

  private transactionResult<T>(
    transaction: IDBTransaction,
    request: IDBRequest<T> | null,
    context: CacheOperationContext,
    timeoutMessage: string,
  ): Promise<T> {
    let requestSettled = request === null
    let transactionSettled = false
    let result: T | undefined
    const rawPromise = new Promise<T>((resolve, reject) => {
      const resolveWhenComplete = (): void => {
        if (requestSettled && transactionSettled) {
          resolve(result as T)
        }
      }
      if (request) {
        request.onsuccess = () => {
          result = request.result
          requestSettled = true
          resolveWhenComplete()
        }
        request.onerror = () => reject(request.error || new Error('模型缓存请求失败'))
      }
      transaction.oncomplete = () => {
        transactionSettled = true
        resolveWhenComplete()
      }
      transaction.onerror = () => reject(transaction.error || new Error('模型缓存事务失败'))
      transaction.onabort = () => reject(transaction.error || new Error('模型缓存事务中止'))
    })

    let abortRequested = false
    const abort = (): void => {
      if (abortRequested) {
        return
      }
      abortRequested = true
      try {
        transaction.abort()
      } catch {
        // The operation race rejects with its authoritative timeout/lifecycle error.
      }
    }
    this.activeTransactionAborts.add(abort)
    return this.waitForOperation(rawPromise, context, timeoutMessage, abort).then(
      (value) => {
        this.activeTransactionAborts.delete(abort)
        return value
      },
      (error: unknown) => {
        this.activeTransactionAborts.delete(abort)
        throw error
      },
    )
  }

  private waitForOperation<T>(
    promise: PromiseLike<T>,
    context: CacheOperationContext,
    timeoutMessage: string,
    cancel: () => void = () => undefined,
  ): Promise<T> {
    try {
      this.assertOperationActive(context, timeoutMessage)
    } catch (error) {
      cancel()
      void Promise.resolve(promise).catch(() => undefined)
      return Promise.reject(error)
    }
    const controlSignals: AbortSignal[] = context.signal
      ? [context.signal, context.lifecycleSignal]
      : [context.lifecycleSignal]
    const controlled = raceAbort(promise, controlSignals, () => this.operationControlError(), {
      onAbort: cancel,
    })
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const deadlineRace = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => {
          cancel()
          reject(new Error(timeoutMessage))
        },
        Math.max(0, context.deadline - Date.now()),
      )
    })
    return Promise.race([controlled, deadlineRace]).finally(() => clearTimeout(timeoutId))
  }

  private assertOperationActive(context: CacheOperationContext, timeoutMessage: string = '模型缓存操作超时'): void {
    if (context.signal?.aborted) {
      throw new ModelCacheLifecycleError('模型缓存操作已取消')
    }
    if (
      context.generation !== this.generation ||
      context.lifecycleSignal.aborted ||
      context.lifecycleSignal !== this.lifecycleController.signal
    ) {
      throw new ModelCacheLifecycleError('模型缓存操作已取消')
    }
    if (!Number.isFinite(context.deadline) || Date.now() >= context.deadline) {
      throw new Error(timeoutMessage)
    }
  }

  private operationControlError(): ModelCacheLifecycleError {
    return new ModelCacheLifecycleError('模型缓存操作已取消')
  }
}
