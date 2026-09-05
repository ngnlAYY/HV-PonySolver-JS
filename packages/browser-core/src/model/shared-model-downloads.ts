import { raceAbort } from '../utils/abort-race'
import { copyModelDownloadConfirmation } from './model-download-confirmation-store'
import { downloadModel } from './model-downloader'
import { modelConfig } from './model-config'
import type { ModelIntegrityOptions } from './model-integrity'
import { ModelCacheLifecycleError } from './indexeddb-model-store'

type SharedDownload = {
  readonly controller: AbortController
  readonly promise: Promise<ArrayBuffer>
  owners: number
  settled: boolean
}

/** 每次网络请求共享，交付给不同 Worker 的可转移缓冲仍各有所有者。 */
export class SharedModelDownloads {
  private lifecycleController = new AbortController()
  private readonly activeDownloads = new Map<string, SharedDownload>()
  constructor(private readonly downloadModelImpl: typeof downloadModel = downloadModel) {}

  async download(
    signal?: AbortSignal,
    verifyIntegrity: boolean = modelConfig.verifyIntegrity,
    accessKeyOverride?: string,
  ): Promise<ArrayBuffer> {
    if (signal?.aborted) {
      throw new Error('模型缓存操作已取消')
    }
    const lifecycleSignal = this.lifecycleController.signal
    // Concurrent callers share one in-flight download so a single monthly-quota
    // GET serves all of them; each caller still honors its own abort signal.
    const normalizedAccessKeyOverride = accessKeyOverride?.trim() || undefined
    const downloadKey = `${verifyIntegrity ? 'verified' : 'unverified'}:${normalizedAccessKeyOverride ?? ''}`
    let shared = this.activeDownloads.get(downloadKey)
    if (!shared) {
      const options: ModelIntegrityOptions =
        normalizedAccessKeyOverride === undefined
          ? { verifyIntegrity }
          : { accessKeyOverride: normalizedAccessKeyOverride, verifyIntegrity }
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
      if (shared.owners <= 1) {
        return buffer
      }
      // A transferable ArrayBuffer has one owner. Keep the original backing
      // store intact for the last consumer and give earlier concurrent owners
      // independent copies while retaining their quota-confirmation receipt.
      const ownerBuffer = buffer.slice(0)
      copyModelDownloadConfirmation(buffer, ownerBuffer)
      return ownerBuffer
    } finally {
      shared.owners -= 1
      if (shared.owners === 0 && !shared.settled && this.activeDownloads.get(downloadKey) === shared) {
        this.activeDownloads.delete(downloadKey)
        shared.controller.abort(new ModelCacheLifecycleError('模型缓存操作已取消'))
      }
    }
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

  close(): void {
    const previous = this.lifecycleController
    this.lifecycleController = new AbortController()
    const error = new ModelCacheLifecycleError('模型缓存操作已取消')
    for (const download of this.activeDownloads.values()) download.controller.abort(error)
    this.activeDownloads.clear()
    previous.abort(error)
  }
}
