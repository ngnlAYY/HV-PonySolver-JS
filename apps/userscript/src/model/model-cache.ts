import type { StatusPanel } from '../status-panel/status-panel-types'
import { formatErrorMessage } from '../utils/errors'
import { warn } from '../utils/logger'
import { modelConfig } from './model-config'
import { downloadModel } from './model-downloader'

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCachedBuffer(row: unknown): ArrayBuffer | null {
  if (!isRecordObject(row) || row.version !== modelConfig.version || !(row.buffer instanceof ArrayBuffer)) {
    return null
  }
  return row.buffer
}

export class ModelCache {
  private db: IDBDatabase | null = null
  private openPromise: Promise<IDBDatabase> | null = null

  constructor(private readonly panel: StatusPanel) {}

  async loadModel(): Promise<ArrayBuffer> {
    this.panel.setStatus({ model: '确认中' })
    try {
      const cached = await this.getCached()
      if (cached) {
        this.panel.setStatus({ model: '已缓存' })
        return cached
      }
    } catch (error) {
      warn('读取模型缓存失败，改为下载模型:', formatErrorMessage(error))
    }

    this.panel.setStatus({ model: '下载中' })
    const buffer = await downloadModel()

    try {
      await this.putCached(buffer)
    } catch (error) {
      warn('写入模型缓存失败，继续使用已下载模型:', formatErrorMessage(error))
    }
    this.panel.setStatus({ model: '已缓存' })
    return buffer
  }

  private async open(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db
    }
    if (this.openPromise) {
      return this.openPromise
    }
    this.openPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(modelConfig.cacheName, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('models', { keyPath: 'key' })
      }
      request.onsuccess = () => {
        this.db = request.result
        this.openPromise = null
        resolve(this.db)
      }
      request.onerror = () => {
        this.openPromise = null
        reject(request.error || new Error('IndexedDB 打开失败'))
      }
    })
    return this.openPromise
  }

  private async getCached(): Promise<ArrayBuffer | null> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readonly')
      const request = tx.objectStore('models').get(modelConfig.cacheKey)
      request.onsuccess = () => {
        const row: unknown = request.result
        resolve(readCachedBuffer(row))
      }
      request.onerror = () => reject(request.error || new Error('模型缓存读取失败'))
      tx.onabort = () => reject(tx.error || new Error('模型缓存读取事务中止'))
    })
  }

  private async putCached(buffer: ArrayBuffer): Promise<void> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readwrite')
      tx.objectStore('models').put({
        key: modelConfig.cacheKey,
        version: modelConfig.version,
        buffer,
        updatedAt: Date.now(),
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('模型缓存写入失败'))
      tx.onabort = () => reject(tx.error || new Error('模型缓存写入事务中止'))
    })
  }
}
