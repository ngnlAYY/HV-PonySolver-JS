import { inferenceTimeoutConfig } from '../inference/inference-config'
import { raceAbort } from '../utils/abort-race'
import { isRecordObject } from '../utils/guards'
import { modelConfig } from './model-config'
import { MODEL_CONFIRMATION_KEY, MODEL_STORE_NAME } from './model-cache-schema'

export type CacheOperationContext = Readonly<{
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

export class ModelCacheLifecycleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelCacheLifecycleError'
  }
}

/** 只管理缓存事务及其生命周期；下载和额度确认由调用方编排。 */
export class IndexedDbModelStore {
  private db: IDBDatabase | null = null
  private openAttempt: OpenAttempt | null = null
  private generation = 0
  private lifecycleController = new AbortController()
  private readonly activeTransactionAborts = new Set<() => void>()

  constructor(private readonly onVersionChange?: () => void) {}

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
    this.db?.close()
    this.db = null
    lifecycleController.abort(closedError)
  }

  createOperationContext(signal: AbortSignal | undefined, deadline: number): CacheOperationContext {
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
          if (this.onVersionChange) this.onVersionChange()
          else this.close()
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

  async read(context: CacheOperationContext): Promise<readonly unknown[]> {
    const db = await this.open(context)
    this.assertOperationActive(context)
    const transaction = db.transaction(MODEL_STORE_NAME, 'readonly')
    const store = transaction.objectStore(MODEL_STORE_NAME)
    return this.transactionResult(
      transaction,
      [store.get(modelConfig.cacheKey), store.get(MODEL_CONFIRMATION_KEY)],
      context,
      '模型缓存读取超时',
    )
  }

  async write(rows: readonly Record<string, unknown>[], context: CacheOperationContext): Promise<void> {
    const db = await this.open(context)
    this.assertOperationActive(context)
    const transaction = db.transaction(MODEL_STORE_NAME, 'readwrite')
    try {
      const store = transaction.objectStore(MODEL_STORE_NAME)
      for (const row of rows) store.put(row)
    } catch (error) {
      this.abortTransaction(transaction)
      throw error
    }
    await this.transactionResult(transaction, [], context, '模型缓存写入超时')
  }

  async confirm(expected: Record<string, unknown>, context: CacheOperationContext): Promise<void> {
    const db = await this.open(context)
    this.assertOperationActive(context)
    const transaction = db.transaction(MODEL_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(MODEL_STORE_NAME)
    await this.transactionResult(
      transaction,
      [store.get(MODEL_CONFIRMATION_KEY)],
      context,
      '模型下载确认状态写入超时',
      ([current]) => {
        this.assertOperationActive(context)
        // 只更新自己的写入，较晚抵达的旧回执不能确认或覆盖另一份缓存。
        if (
          !isRecordObject(current) ||
          current.cacheWriteId !== expected.cacheWriteId ||
          current.version !== expected.version ||
          current.sha256 !== expected.sha256 ||
          current.byteLength !== expected.byteLength
        ) {
          throw new ModelCacheLifecycleError('模型缓存已被其他下载替换')
        }
        store.put({ ...expected, confirmationPending: false, updatedAt: Date.now() })
      },
    )
  }

  private abortTransaction(transaction: IDBTransaction): void {
    try {
      transaction.abort()
    } catch {
      /* 已结束的事务保留原始错误。 */
    }
  }

  private transactionResult(
    transaction: IDBTransaction,
    requests: readonly IDBRequest[],
    context: CacheOperationContext,
    timeoutMessage: string,
    onRead?: (values: readonly unknown[]) => void,
  ): Promise<readonly unknown[]> {
    let completedReads = 0
    let transactionSettled = false
    const results: unknown[] = []
    const rawPromise = new Promise<readonly unknown[]>((resolve, reject) => {
      const resolveWhenComplete = (): void => {
        if (completedReads === requests.length && transactionSettled) resolve(results)
      }
      requests.forEach((request, index) => {
        request.onsuccess = () => {
          results[index] = request.result
          completedReads += 1
          if (completedReads === requests.length) {
            try {
              onRead?.(results)
            } catch (error) {
              this.abortTransaction(transaction)
              reject(error)
              return
            }
          }
          resolveWhenComplete()
        }
        request.onerror = () => reject(request.error || new Error('模型缓存请求失败'))
      })
      transaction.oncomplete = () => {
        transactionSettled = true
        resolveWhenComplete()
      }
      transaction.onerror = () => reject(transaction.error || new Error('模型缓存事务失败'))
      transaction.onabort = () => reject(transaction.error || new Error('模型缓存事务中止'))
    })
    let abortRequested = false
    const abort = (): void => {
      if (abortRequested) return
      abortRequested = true
      this.abortTransaction(transaction)
    }
    this.activeTransactionAborts.add(abort)
    return this.waitForOperation(rawPromise, context, timeoutMessage, abort).finally(() =>
      this.activeTransactionAborts.delete(abort),
    )
  }

  waitForOperation<T>(
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

  assertOperationActive(context: CacheOperationContext, timeoutMessage: string = '模型缓存操作超时'): void {
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
