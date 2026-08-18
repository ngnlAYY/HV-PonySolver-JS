import type { AsyncStringStorage } from '@hv-pony-solver/browser-core/platform/storage'

const DATABASE_NAME = 'hvPonySolverExtensionSecrets'
const STORE_NAME = 'values'
export const INDEXED_DB_OPEN_TIMEOUT_MS = 5_000
const INDEXED_DB_TRANSACTION_TIMEOUT_MS = 5_000

type StoredValue = Readonly<{ key: string; value: string }>

type OpenAttempt = {
  readonly promise: Promise<IDBDatabase>
  readonly cancel: (error: Error) => void
  owners: number
  settled: boolean
}

function requestResult<T>(request: IDBRequest<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      callback()
    }
    const onAbort = (): void => finish(() => reject(new Error('扩展 Key 存储操作已取消')))
    const timeoutId = setTimeout(
      () => finish(() => reject(new Error('IndexedDB 请求超时'))),
      INDEXED_DB_TRANSACTION_TIMEOUT_MS,
    )
    signal?.addEventListener('abort', onAbort, { once: true })
    request.onsuccess = () => finish(() => resolve(request.result))
    request.onerror = () => finish(() => reject(request.error ?? new Error('IndexedDB 请求失败')))
    if (signal?.aborted) {
      onAbort()
    }
  })
}

export class IndexedDbStringStorage implements AsyncStringStorage {
  private database: IDBDatabase | null = null
  private openAttempt: OpenAttempt | null = null
  private generation = 0
  private readonly activeTransactionAborts = new Set<(error: Error) => void>()

  async get(key: string, signal?: AbortSignal): Promise<string | null> {
    const generation = this.generation
    this.assertActive(generation, signal)
    const database = await this.open(generation, signal)
    this.assertActive(generation, signal)
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const [row] = await Promise.all([
      requestResult(transaction.objectStore(STORE_NAME).get(key), signal) as Promise<StoredValue | undefined>,
      this.transactionComplete(transaction, generation, signal),
    ])
    this.assertActive(generation, signal)
    return typeof row?.value === 'string' ? row.value : null
  }

  async set(key: string, value: string, signal?: AbortSignal): Promise<void> {
    const generation = this.generation
    this.assertActive(generation, signal)
    const database = await this.open(generation, signal)
    this.assertActive(generation, signal)
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({ key, value } satisfies StoredValue)
    await this.transactionComplete(transaction, generation, signal)
    this.assertActive(generation, signal)
  }

  async remove(key: string, signal?: AbortSignal): Promise<void> {
    const generation = this.generation
    this.assertActive(generation, signal)
    const database = await this.open(generation, signal)
    this.assertActive(generation, signal)
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    await this.transactionComplete(transaction, generation, signal)
    this.assertActive(generation, signal)
  }

  async close(): Promise<void> {
    this.generation += 1
    const closedError = new Error('扩展 Key 数据库已关闭')
    for (const abort of [...this.activeTransactionAborts]) {
      abort(closedError)
    }
    this.activeTransactionAborts.clear()
    this.openAttempt?.cancel(closedError)
    this.openAttempt = null
    this.database?.close()
    this.database = null
  }

  private async open(generation: number, signal?: AbortSignal): Promise<IDBDatabase> {
    this.assertActive(generation, signal)
    if (this.database) {
      return this.database
    }
    const attempt = this.openAttempt ?? this.createOpenAttempt(generation)
    attempt.owners += 1
    try {
      const database = await this.waitForOpen(attempt.promise, generation, signal)
      this.assertActive(generation, signal)
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
      request = indexedDB.open(DATABASE_NAME, 1)
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
    const timeoutId = setTimeout(() => reject(new Error('IndexedDB 打开超时')), INDEXED_DB_OPEN_TIMEOUT_MS)

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      if (attempt.settled || generation !== this.generation || this.openAttempt !== attempt) {
        database.close()
        reject(new Error('扩展 Key 数据库已关闭'))
        return
      }
      this.database = database
      database.onversionchange = () => {
        if (this.database === database) {
          void this.close()
        } else {
          database.close()
        }
      }
      resolve(database)
    }
    request.onerror = () => reject(request.error ?? new Error('无法打开扩展 Key 数据库'))
    request.onblocked = () => reject(new Error('扩展 Key 数据库升级被阻止'))
    return attempt
  }

  private waitForOpen(promise: Promise<IDBDatabase>, generation: number, signal?: AbortSignal): Promise<IDBDatabase> {
    try {
      this.assertActive(generation, signal)
    } catch (error) {
      void promise.catch(() => undefined)
      return Promise.reject(error)
    }
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = (): void => signal?.removeEventListener('abort', onAbort)
      const finish = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        callback()
      }
      const onAbort = (): void => finish(() => reject(new Error('扩展 Key 存储操作已取消')))
      signal?.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (database) => finish(() => resolve(database)),
        (error: unknown) => finish(() => reject(error)),
      )
      if (signal?.aborted || generation !== this.generation) {
        onAbort()
      }
    })
  }

  private transactionComplete(transaction: IDBTransaction, generation: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        clearTimeout(timeoutId)
        this.activeTransactionAborts.delete(abort)
        signal?.removeEventListener('abort', abortFromSignal)
      }
      const finish = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        callback()
      }
      const abort = (error: Error): void => {
        try {
          transaction.abort()
        } catch {
          // The bounded local settlement remains authoritative.
        }
        finish(() => reject(error))
      }
      const abortFromSignal = (): void => abort(new Error('扩展 Key 存储操作已取消'))
      const timeoutId = setTimeout(() => abort(new Error('IndexedDB 事务超时')), INDEXED_DB_TRANSACTION_TIMEOUT_MS)
      this.activeTransactionAborts.add(abort)
      signal?.addEventListener('abort', abortFromSignal, { once: true })
      transaction.oncomplete = () =>
        finish(() => {
          try {
            this.assertActive(generation, signal)
            resolve()
          } catch (error) {
            reject(error)
          }
        })
      transaction.onerror = () => finish(() => reject(transaction.error ?? new Error('IndexedDB 事务失败')))
      transaction.onabort = () =>
        finish(() =>
          reject(
            signal?.aborted
              ? new Error('扩展 Key 存储操作已取消')
              : generation !== this.generation
                ? new Error('扩展 Key 数据库已关闭')
                : (transaction.error ?? new Error('IndexedDB 事务已中止')),
          ),
        )
      if (signal?.aborted) {
        abortFromSignal()
      } else if (generation !== this.generation) {
        abort(new Error('扩展 Key 数据库已关闭'))
      }
    })
  }

  private assertActive(generation: number, signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('扩展 Key 存储操作已取消')
    }
    if (generation !== this.generation) {
      throw new Error('扩展 Key 数据库已关闭')
    }
  }
}
