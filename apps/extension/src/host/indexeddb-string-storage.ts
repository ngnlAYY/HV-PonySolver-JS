import type { AsyncStringStorage } from '@hv-pony-solver/browser-core'

const DATABASE_NAME = 'hvPonySolverExtensionSecrets'
const STORE_NAME = 'values'

type StoredValue = Readonly<{ key: string; value: string }>

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已中止'))
  })
}

export class IndexedDbStringStorage implements AsyncStringStorage {
  private databasePromise: Promise<IDBDatabase> | null = null

  async get(key: string): Promise<string | null> {
    const database = await this.open()
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const row = await requestResult(transaction.objectStore(STORE_NAME).get(key)) as StoredValue | undefined
    await transactionComplete(transaction)
    return typeof row?.value === 'string' ? row.value : null
  }

  async set(key: string, value: string): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({ key, value } satisfies StoredValue)
    await transactionComplete(transaction)
  }

  async remove(key: string): Promise<void> {
    const database = await this.open()
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    await transactionComplete(transaction)
  }

  async close(): Promise<void> {
    if (!this.databasePromise) {
      return
    }
    const database = await this.databasePromise
    database.close()
    this.databasePromise = null
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) {
      return this.databasePromise
    }
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
      request.onerror = () => {
        this.databasePromise = null
        reject(request.error ?? new Error('无法打开扩展 Key 数据库'))
      }
      request.onblocked = () => {
        this.databasePromise = null
        reject(new Error('扩展 Key 数据库升级被阻止'))
      }
    })
    return this.databasePromise
  }
}
