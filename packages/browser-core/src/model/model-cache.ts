import type { CacheStatusSink } from '../status-panel/status-panel-types'
import { inferenceTimeoutConfig } from '../inference/inference-config'
import { formatErrorMessage } from '../utils/errors'
import { warn } from '../utils/logger'
import { modelConfig } from './model-config'
import { getModelDownloadConfirmation } from './model-download-confirmation-store'
import { confirmCachedModelDownload, downloadModel } from './model-downloader'
import { IndexedDbModelStore, ModelCacheLifecycleError } from './indexeddb-model-store'
import { MODEL_CONFIRMATION_KEY } from './model-cache-schema'
import { SharedModelDownloads } from './shared-model-downloads'
import { createCachedModelRow, readCachedModelBuffer } from './model-cache-record'

export { createCachedModelRow, readCachedModelBuffer } from './model-cache-record'

export class ModelCache {
  private readonly store: IndexedDbModelStore
  private readonly downloads: SharedModelDownloads

  constructor(
    private readonly statusSink: CacheStatusSink,
    downloadModelImpl: typeof downloadModel = downloadModel,
  ) {
    this.downloads = new SharedModelDownloads(downloadModelImpl)
    this.store = new IndexedDbModelStore(() => this.close())
  }

  async getCached(
    signal?: AbortSignal,
    deadline: number = Date.now() + inferenceTimeoutConfig.modelCacheTimeoutMs,
  ): Promise<ArrayBuffer | null> {
    const context = this.store.createOperationContext(signal, deadline)
    const startedAt = Date.now()
    this.statusSink.setStatus({ model: '确认缓存中' })
    try {
      this.store.assertOperationActive(context)
      const [row, confirmation] = await this.store.read(context)
      const cached = await this.store.waitForOperation(
        readCachedModelBuffer(row, {}, confirmation),
        context,
        '模型缓存完整性校验超时',
      )
      this.store.assertOperationActive(context)
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
    if (signal?.aborted) throw new ModelCacheLifecycleError('模型缓存操作已取消')
    const startedAt = Date.now()
    this.statusSink.setStatus({ model: '下载中' })
    const buffer = await this.downloads.download(signal, verifyIntegrity, accessKeyOverride)
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
    const context = this.store.createOperationContext(signal, startedAt + inferenceTimeoutConfig.modelCacheTimeoutMs)
    try {
      this.store.assertOperationActive(context)
      const confirmationPending = getModelDownloadConfirmation(buffer) !== undefined
      const row: Record<string, unknown> = {
        ...(await this.store.waitForOperation(
          createCachedModelRow(
            buffer,
            { verifyIntegrity: skipIntegrityVerification ? false : verifyIntegrity },
            confirmationPending,
          ),
          context,
          '模型缓存完整性校验超时',
        )),
        cacheWriteId: crypto.randomUUID(),
      }
      const confirmation = {
        key: MODEL_CONFIRMATION_KEY,
        version: row.version,
        byteLength: row.byteLength,
        sha256: row.sha256,
        cacheWriteId: row.cacheWriteId,
        confirmationPending,
        updatedAt: Date.now(),
      }
      // 内容与待确认状态在同一事务内落盘，随后只更新不包含模型的元数据。
      await this.store.write([row, confirmation], context)
      this.store.assertOperationActive(context)
      const confirmationController = new AbortController()
      const confirmationPromise = confirmCachedModelDownload(buffer, confirmationController.signal)
      await this.store.waitForOperation(confirmationPromise, context, '模型下载缓存确认超时', () =>
        confirmationController.abort(new ModelCacheLifecycleError('模型缓存操作已取消')),
      )
      this.store.assertOperationActive(context)
      if (confirmationPending) await this.store.confirm(confirmation, context)
      this.store.assertOperationActive(context)
      this.statusSink.setStatus({ model: `已缓存 ${Date.now() - startedAt}ms` })
    } catch (error) {
      warn('模型缓存或下载次数确认失败，继续使用已下载模型:', formatErrorMessage(error))
      if (verifyIntegrity || error instanceof ModelCacheLifecycleError) throw error
    }
  }

  close(): void {
    this.store.close()
    this.downloads.close()
  }
}
