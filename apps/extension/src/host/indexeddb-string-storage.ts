import type { AsyncStringStorage } from '@hv-pony-solver/browser-core/platform/storage'

const DATABASE_NAME = 'hvPonySolverExtensionSecrets'
const STORE_NAME = 'values'

type StoredValue = Readonly<{ key: string; value: string }>

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

export class IndexedDbStringStorage implements AsyncStringStorage {
  private databasePromise: Promise<IDBDatabase> | null = null
  private generation = 0
  private readonly activeTransactions = new Set<IDBTransaction>()

  async get(key: string, signal?: AbortSignal): Promise<string | null> {
    const generation = this.generation
    this.assertActive(generation, signal)
    const database = await this.open(generation)
    this.assertActive(generation, signal)
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const [row] = await Promise.all([
      requestResult(transaction.objectStore(STORE_NAME).get(key)) as Promise<StoredValue | undefined>,
      this.transactionComplete(transaction, generation, signal),
    ])
    this.assertActive(generation, signal)
    return typeof row?.value === 'string' ? row.value : null
  }

  async set(key: string, value: string, signal?: AbortSignal): Promise<void> {
    const generation = this.generation
    this.assertActive(generation, signal)
    const database = await this.open(generation)
    this.assertActive(generation, signal)
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({ key, value } satisfies StoredValue)
    await this.transactionComplete(transaction, generation, signal)
    this.assertActive(generation, signal)
  }

  async remove(key: string, signal?: AbortSignal): Promise<void> {
    const generation = this.generation
    this.assertActive(generation, signal)
    const database = await this.open(generation)
    this.assertActive(generation, signal)
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    await this.transactionComplete(transaction, generation, signal)
    this.assertActive(generation, signal)
  }

  async close(): Promise<void> {
    this.generation += 1
    for (const transaction of this.activeTransactions) {
      try {
        transaction.abort()
      } catch {
        // A settled transaction no longer needs cancellation.
      }
    }
    this.activeTransactions.clear()
    const databasePromise = this.databasePromise
    this.databasePromise = null
    if (!databasePromise) {
      return
    }
    try {
      const database = await databasePromise
      database.close()
    } catch {
      // A stale or failed open is already closed/rejected by its own handler.
    }
  }

  private open(generation: number): Promise<IDBDatabase> {
    if (this.databasePromise) {
      return this.databasePromise
    }
    const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => {
        if (generation !== this.generation) {
          request.result.close()
          reject(new Error('扩展 Key 数据库已关闭'))
          return
        }
        request.result.onversionchange = () => {
          request.result.close()
          void this.close()
        }
        resolve(request.result)
      }
      request.onerror = () => {
        if (this.databasePromise === databasePromise) {
          this.databasePromise = null
        }
        reject(request.error ?? new Error('无法打开扩展 Key 数据库'))
      }
      request.onblocked = () => {
        if (this.databasePromise === databasePromise) {
          this.databasePromise = null
        }
        reject(new Error('扩展 Key 数据库升级被阻止'))
      }
    })
    this.databasePromise = databasePromise
    return databasePromise
  }

  private transactionComplete(
    transaction: IDBTransaction,
    generation: number,
    signal?: AbortSignal,
  ): Promise<void> {
    this.activeTransactions.add(transaction)
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        this.activeTransactions.delete(transaction)
        signal?.removeEventListener('abort', abort)
      }
      const finish = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        callback()
      }
      const abort = (): void => {
        try {
          transaction.abort()
        } catch {
          finish(() => reject(new Error('扩展 Key 存储操作已取消')))
        }
      }
      signal?.addEventListener('abort', abort, { once: true })
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
      if (signal?.aborted || generation !== this.generation) {
        abort()
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
