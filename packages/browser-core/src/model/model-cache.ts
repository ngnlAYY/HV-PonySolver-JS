import type { CacheStatusSink } from '../status-panel/status-panel-types'
import { formatErrorMessage } from '../utils/errors'
import { isRecordObject } from '../utils/guards'
import { warn } from '../utils/logger'
import { modelConfig } from './model-config'
import { downloadModel, type ModelIntegrityOptions } from './model-downloader'
import { verifyModelIntegrity } from './model-integrity'

function resolveIntegrityOptions(options: ModelIntegrityOptions = {}): {
  integrity: NonNullable<ModelIntegrityOptions['integrity']>
  verifyIntegrity: boolean
  forceVerifyIntegrity: boolean
} {
  return {
    integrity: options.integrity ?? modelConfig.integrity,
    verifyIntegrity: options.forceVerifyIntegrity ? true : (options.verifyIntegrity ?? modelConfig.verifyIntegrity),
    forceVerifyIntegrity: options.forceVerifyIntegrity ?? false,
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
  private openPromise: Promise<IDBDatabase> | null = null
  private openRequestId = 0
  private readonly activeWriteTransactions = new Set<IDBTransaction>()

  constructor(
    private readonly statusSink: CacheStatusSink,
    private readonly downloadModelImpl: typeof downloadModel = downloadModel,
  ) {}

  async getCached(): Promise<ArrayBuffer | null> {
    const requestId = this.openRequestId
    const startedAt = Date.now()
    this.statusSink.setStatus({ model: '确认缓存中' })
    try {
      const cached = await this.readCached(requestId)
      this.assertOperationActive(requestId)
      const elapsed = Date.now() - startedAt
      if (cached) {
        this.statusSink.setStatus({ model: `缓存命中 ${elapsed}ms` })
        return cached
      }
      this.statusSink.setStatus({ model: `缓存未命中 ${elapsed}ms` })
    } catch (error) {
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
    this.statusSink.setStatus({ model: '下载中' })
    const options: ModelIntegrityOptions = accessKeyOverride === undefined
      ? { verifyIntegrity }
      : { accessKeyOverride, verifyIntegrity }
    const buffer = await this.downloadModelImpl(signal, options)
    if (signal?.aborted) {
      throw new Error('模型缓存操作已取消')
    }
    this.statusSink.setStatus({ model: `下载完成 ${Date.now() - startedAt}ms` })
    return buffer
  }

  async putCached(
    buffer: ArrayBuffer,
    verifyIntegrity: boolean = modelConfig.verifyIntegrity,
    skipIntegrityVerification: boolean = false,
    signal?: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now()
    const requestId = this.openRequestId
    try {
      this.assertOperationActive(requestId, signal)
      await this.writeCached(buffer, verifyIntegrity, skipIntegrityVerification, requestId, signal)
      this.assertOperationActive(requestId, signal)
      this.statusSink.setStatus({ model: `已缓存 ${Date.now() - startedAt}ms` })
    } catch (error) {
      warn('写入模型缓存失败，继续使用已下载模型:', formatErrorMessage(error))
      if (verifyIntegrity || signal?.aborted || this.openRequestId !== requestId) {
        throw error
      }
    }
  }

  close(): void {
    this.openRequestId += 1
    for (const transaction of this.activeWriteTransactions) {
      try {
        transaction.abort()
      } catch {
        // A transaction that has already settled needs no further cleanup.
      }
    }
    this.activeWriteTransactions.clear()
    this.db?.close()
    this.db = null
    this.openPromise = null
  }

  private async open(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db
    }
    if (this.openPromise) {
      return this.openPromise
    }
    const requestId = this.openRequestId
    const openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(modelConfig.cacheName, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('models', { keyPath: 'key' })
      }
      request.onsuccess = () => {
        if (this.openRequestId !== requestId) {
          request.result.close()
          reject(new Error('模型缓存已关闭'))
          return
        }
        this.db = request.result
        this.db.onversionchange = () => this.close()
        this.openPromise = null
        resolve(this.db)
      }
      request.onerror = () => {
        this.openPromise = null
        reject(request.error || new Error('IndexedDB 打开失败'))
      }
    })
    this.openPromise = openPromise
    return openPromise
  }

  private async readCached(requestId: number): Promise<ArrayBuffer | null> {
    const db = await this.open()
    this.assertOperationActive(requestId)
    return new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readonly')
      const request = tx.objectStore('models').get(modelConfig.cacheKey)
      request.onsuccess = () => {
        const row: unknown = request.result
        readCachedModelBuffer(row).then(resolve, reject)
      }
      request.onerror = () => reject(request.error || new Error('模型缓存读取失败'))
      tx.onabort = () => reject(tx.error || new Error('模型缓存读取事务中止'))
    })
  }

  private async writeCached(
    buffer: ArrayBuffer,
    verifyIntegrity: boolean,
    skipIntegrityVerification: boolean,
    requestId: number,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertOperationActive(requestId, signal)
    const row = await createCachedModelRow(buffer, {
      verifyIntegrity: skipIntegrityVerification ? false : verifyIntegrity,
    })
    this.assertOperationActive(requestId, signal)
    const db = await this.open()
    this.assertOperationActive(requestId, signal)
    return new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readwrite')
      this.activeWriteTransactions.add(tx)
      let settled = false
      const cleanup = (): void => {
        this.activeWriteTransactions.delete(tx)
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
          tx.abort()
        } catch {
          finish(() => reject(new Error('模型缓存操作已取消')))
        }
      }
      signal?.addEventListener('abort', abort, { once: true })
      tx.objectStore('models').put(row)
      tx.oncomplete = () =>
        finish(() => {
          try {
            this.assertOperationActive(requestId, signal)
            resolve()
          } catch (error) {
            reject(error)
          }
        })
      tx.onerror = () => finish(() => reject(tx.error || new Error('模型缓存写入失败')))
      tx.onabort = () =>
        finish(() =>
          reject(
            signal?.aborted || this.openRequestId !== requestId
              ? new Error('模型缓存操作已取消')
              : (tx.error || new Error('模型缓存写入事务中止')),
          ),
        )
      if (signal?.aborted || this.openRequestId !== requestId) {
        abort()
      }
    })
  }

  private assertOperationActive(requestId: number, signal?: AbortSignal): void {
    if (signal?.aborted || this.openRequestId !== requestId) {
      throw new Error('模型缓存操作已取消')
    }
  }
}
