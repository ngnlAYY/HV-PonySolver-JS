import type { CacheStatusSink } from '../status-panel/status-panel-types'
import { formatErrorMessage } from '../utils/errors'
import { isRecordObject } from '../utils/guards'
import { warn } from '../utils/logger'
import { modelConfig } from './model-config'
import { downloadModel, type ModelIntegrityOptions } from './model-downloader'
import { verifyModelIntegrity } from './model-integrity'

function resolveIntegrityOptions(options: ModelIntegrityOptions = {}): Required<ModelIntegrityOptions> {
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

  constructor(private readonly statusSink: CacheStatusSink) {}

  async getCached(): Promise<ArrayBuffer | null> {
    const startedAt = Date.now()
    this.statusSink.setStatus({ model: '确认缓存中' })
    try {
      const cached = await this.readCached()
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

  async download(signal?: AbortSignal, verifyIntegrity: boolean = modelConfig.verifyIntegrity): Promise<ArrayBuffer> {
    const startedAt = Date.now()
    this.statusSink.setStatus({ model: '下载中' })
    const buffer = await downloadModel(signal, { verifyIntegrity })
    this.statusSink.setStatus({ model: `下载完成 ${Date.now() - startedAt}ms` })
    return buffer
  }

  async putCached(
    buffer: ArrayBuffer,
    verifyIntegrity: boolean = modelConfig.verifyIntegrity,
    skipIntegrityVerification: boolean = false,
  ): Promise<void> {
    const startedAt = Date.now()
    try {
      await this.writeCached(buffer, verifyIntegrity, skipIntegrityVerification)
      this.statusSink.setStatus({ model: `已缓存 ${Date.now() - startedAt}ms` })
    } catch (error) {
      warn('写入模型缓存失败，继续使用已下载模型:', formatErrorMessage(error))
      if (verifyIntegrity) {
        throw error
      }
    }
  }

  close(): void {
    this.openRequestId += 1
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

  private async readCached(): Promise<ArrayBuffer | null> {
    const db = await this.open()
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
  ): Promise<void> {
    const db = await this.open()
    const row = await createCachedModelRow(buffer, {
      verifyIntegrity: skipIntegrityVerification ? false : verifyIntegrity,
    })
    return new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readwrite')
      tx.objectStore('models').put(row)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('模型缓存写入失败'))
      tx.onabort = () => reject(tx.error || new Error('模型缓存写入事务中止'))
    })
  }
}
