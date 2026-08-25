import type * as ModelIntegrityModule from '../../src/model/model-integrity'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/model/model-downloader', () => ({
  confirmCachedModelDownload: vi.fn(async () => undefined),
  downloadModel: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
}))
vi.mock('../../src/model/model-integrity', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelIntegrityModule>()
  return {
    ...actual,
    verifyModelIntegrity: vi.fn(actual.verifyModelIntegrity),
  }
})

import { inferenceTimeoutConfig } from '../../src/inference/inference-config'
import { createCachedModelRow, ModelCache, readCachedModelBuffer } from '../../src/model/model-cache'
import { confirmCachedModelDownload, downloadModel } from '../../src/model/model-downloader'
import { verifyModelIntegrity } from '../../src/model/model-integrity'
import { modelConfig } from '../../src/model/model-config'
import type { StatusPanel } from '../../src/status-panel/status-panel-types'

const TEST_SHA256 = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
const TEST_INTEGRITY = { byteLength: 3, sha256: TEST_SHA256 } as const

type TestObjectStore = Pick<IDBObjectStore, 'get' | 'put'>
type TestTransaction = {
  abort: ReturnType<typeof vi.fn>
  objectStore: (name: string) => IDBObjectStore
  onabort: ((event: Event) => void) | null
  oncomplete: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  error: DOMException | null
}
type TestRequest = {
  onerror: ((event: Event) => void) | null
  onsuccess: ((event: Event) => void) | null
  result: unknown
  error: DOMException | null
}
type TestOpenRequest = TestRequest & {
  onblocked: ((event: Event) => void) | null
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null
  result: IDBDatabase
}
type TestDatabase = Pick<IDBDatabase, 'close' | 'createObjectStore' | 'onversionchange' | 'transaction'>

function bufferFromBytes(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

function createStatusPanel(): StatusPanel {
  return {
    setStatus: vi.fn(),
    setSessionReady: vi.fn(),
    addSuccess: vi.fn(),
    addManualResult: vi.fn(),
    addRandomFailure: vi.fn(),
    addError: vi.fn(),
    create: vi.fn(),
    destroy: vi.fn(),
  }
}

function stubIndexedDb(
  options: Readonly<{
    cachedRow?: Record<string, unknown>
    readError?: DOMException
    openError?: DOMException
    deferOpenSuccess?: boolean
    deferTransactionCompletion?: boolean
  }> = {},
): Readonly<{
  request: TestOpenRequest
  database: TestDatabase
  transactions: TestTransaction[]
}> {
  const { cachedRow, readError, openError, deferOpenSuccess = false, deferTransactionCompletion = false } = options
  const transactions: TestTransaction[] = []
  const readRequest: TestRequest = {
    onerror: null,
    onsuccess: null,
    result: cachedRow,
    error: readError ?? null,
  }
  const objectStore: TestObjectStore = {
    get: vi.fn(() => {
      queueMicrotask(() => {
        if (readError) {
          readRequest.onerror?.(new Event('error'))
          return
        }
        readRequest.onsuccess?.(new Event('success'))
      })
      return readRequest as unknown as IDBRequest
    }),
    put: vi.fn(),
  }
  const database: TestDatabase = {
    close: vi.fn(),
    createObjectStore: vi.fn(),
    onversionchange: null,
    transaction: vi.fn(() => {
      const transaction: TestTransaction = {
        abort: vi.fn(() => {
          queueMicrotask(() => transaction.onabort?.(new Event('abort')))
        }),
        objectStore: vi.fn(() => objectStore as IDBObjectStore),
        onabort: null,
        oncomplete: null,
        onerror: null,
        error: null,
      }
      transactions.push(transaction)
      if (!deferTransactionCompletion) {
        queueMicrotask(() => transaction.oncomplete?.(new Event('complete')))
      }
      return transaction as unknown as IDBTransaction
    }),
  }
  const request: TestOpenRequest = {
    onerror: null,
    onsuccess: null,
    onblocked: null,
    onupgradeneeded: null,
    result: database as IDBDatabase,
    error: openError ?? null,
  }
  const indexedDb = {
    open: vi.fn(() => {
      const completeOpen = (): void => {
        if (openError) {
          request.onerror?.(new Event('error'))
          return
        }
        request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
        request.onsuccess?.(new Event('success'))
      }
      if (!deferOpenSuccess) {
        queueMicrotask(completeOpen)
      }
      return request as unknown as IDBOpenDBRequest
    }),
  }

  vi.stubGlobal('indexedDB', indexedDb)
  return { request, database, transactions }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('readCachedModelBuffer', () => {
  it('returns cached buffers that match the configured integrity by default', async () => {
    const buffer = bufferFromBytes([1, 2, 3])

    await expect(
      readCachedModelBuffer(
        {
          key: modelConfig.cacheKey,
          version: modelConfig.version,
          byteLength: TEST_INTEGRITY.byteLength,
          sha256: TEST_INTEGRITY.sha256,
          buffer,
        },
        { integrity: TEST_INTEGRITY },
      ),
    ).resolves.toBe(buffer)
  })

  it('ignores cached buffers with mismatched integrity by default', async () => {
    await expect(
      readCachedModelBuffer(
        {
          key: modelConfig.cacheKey,
          version: modelConfig.version,
          byteLength: 1,
          sha256: TEST_INTEGRITY.sha256,
          buffer: bufferFromBytes([9]),
        },
        { integrity: TEST_INTEGRITY },
      ),
    ).resolves.toBeNull()
  })

  it('ignores cached buffers with forged integrity metadata by default', async () => {
    await expect(
      readCachedModelBuffer(
        {
          key: modelConfig.cacheKey,
          version: modelConfig.version,
          byteLength: TEST_INTEGRITY.byteLength,
          sha256: TEST_INTEGRITY.sha256,
          buffer: bufferFromBytes([9, 9, 9]),
        },
        { integrity: TEST_INTEGRITY },
      ),
    ).resolves.toBeNull()
  })

  it('returns cached buffers without integrity checks when explicitly disabled', async () => {
    const buffer = bufferFromBytes([9, 9, 9])

    await expect(
      readCachedModelBuffer(
        {
          key: modelConfig.cacheKey,
          version: modelConfig.version,
          byteLength: 1,
          sha256: '0000000000000000000000000000000000000000000000000000000000000000',
          buffer,
        },
        { integrity: TEST_INTEGRITY, verifyIntegrity: false },
      ),
    ).resolves.toBe(buffer)
  })
})

describe('ModelCache', () => {
  it('reports elapsed time when cached model is found', async () => {
    const buffer = bufferFromBytes([9, 9, 9])
    vi.mocked(verifyModelIntegrity).mockResolvedValueOnce(undefined)
    stubIndexedDb({
      cachedRow: {
        key: modelConfig.cacheKey,
        version: modelConfig.version,
        byteLength: modelConfig.integrity.byteLength,
        sha256: modelConfig.integrity.sha256,
        buffer,
      },
    })
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)

    await expect(cache.getCached()).resolves.toBe(buffer)

    expect(panel.setStatus).toHaveBeenCalledWith({ model: '确认缓存中' })
    expect(panel.setStatus).toHaveBeenCalledWith({ model: expect.stringMatching(/^缓存命中 \d+ms$/) })
  })

  it('reports elapsed time when cached model is missing', async () => {
    stubIndexedDb()
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)

    await expect(cache.getCached()).resolves.toBeNull()

    expect(panel.setStatus).toHaveBeenCalledWith({ model: '确认缓存中' })
    expect(panel.setStatus).toHaveBeenCalledWith({ model: expect.stringMatching(/^缓存未命中 \d+ms$/) })
  })

  it('reports elapsed cache read failures before falling back to download', async () => {
    stubIndexedDb({ readError: new DOMException('读取失败') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)

    await expect(cache.getCached()).resolves.toBeNull()

    expect(panel.setStatus).toHaveBeenCalledWith({ model: expect.stringMatching(/^缓存读取失败 \d+ms，准备下载$/) })
  })

  it('falls back to download when IndexedDB open fails', async () => {
    stubIndexedDb({ openError: new DOMException('打开失败') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)

    await expect(cache.getCached()).resolves.toBeNull()

    expect(panel.setStatus).toHaveBeenCalledWith({ model: expect.stringMatching(/^缓存读取失败 \d+ms，准备下载$/) })
  })

  it('falls back immediately when IndexedDB open is blocked and closes a late database', async () => {
    const { request, database } = stubIndexedDb({ deferOpenSuccess: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new ModelCache(createStatusPanel())
    const promise = cache.getCached()

    request.onblocked?.(new Event('blocked'))

    await expect(promise).resolves.toBeNull()
    request.onsuccess?.(new Event('success'))
    expect(database.close).toHaveBeenCalledTimes(1)
  })

  it('closes an IndexedDB database delivered after the caller deadline', async () => {
    const { request, database } = stubIndexedDb({ deferOpenSuccess: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new ModelCache(createStatusPanel())
    const promise = cache.getCached(undefined, Date.now() + 20)

    await expect(promise).resolves.toBeNull()
    request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
    request.onsuccess?.(new Event('success'))

    expect(database.createObjectStore).toHaveBeenCalledTimes(1)
    expect(database.close).toHaveBeenCalledTimes(1)
  })

  it('bounds a hung IndexedDB open and closes a database delivered after the timeout', async () => {
    vi.useFakeTimers()
    const { request, database } = stubIndexedDb({ deferOpenSuccess: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new ModelCache(createStatusPanel())
    const promise = cache.getCached()

    await vi.advanceTimersByTimeAsync(inferenceTimeoutConfig.modelCacheTimeoutMs)

    await expect(promise).resolves.toBeNull()
    request.onsuccess?.(new Event('success'))
    expect(database.close).toHaveBeenCalledTimes(1)
  })

  it('rejects an aborted IndexedDB open without waiting for the open request', async () => {
    const { request, database } = stubIndexedDb({ deferOpenSuccess: true })
    const cache = new ModelCache(createStatusPanel())
    const controller = new AbortController()
    const promise = cache.getCached(controller.signal)

    controller.abort()

    await expect(promise).rejects.toThrow('模型缓存操作已取消')
    request.onsuccess?.(new Event('success'))
    expect(database.close).toHaveBeenCalledTimes(1)
  })

  it('keeps a shared IndexedDB open alive while another caller still owns it', async () => {
    const { request, database } = stubIndexedDb({ deferOpenSuccess: true })
    const cache = new ModelCache(createStatusPanel())
    const controller = new AbortController()
    const abandoned = cache.getCached(controller.signal)
    const remaining = cache.getCached()

    controller.abort()
    await expect(abandoned).rejects.toThrow('模型缓存操作已取消')
    request.onsuccess?.(new Event('success'))

    await expect(remaining).resolves.toBeNull()
    expect(database.close).not.toHaveBeenCalled()
  })

  it('rejects stale open requests after close instead of reporting a cache miss', async () => {
    const { request, database } = stubIndexedDb({ deferOpenSuccess: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)
    const promise = cache.getCached()

    cache.close()
    request.onsuccess?.(new Event('success'))

    await expect(promise).rejects.toThrow('模型缓存操作已取消')
    expect(database.close).toHaveBeenCalledTimes(1)
  })

  it('closes the cached database on versionchange', async () => {
    const { database } = stubIndexedDb()
    const cache = new ModelCache(createStatusPanel())

    await cache.getCached()
    database.onversionchange?.(new Event('versionchange'))

    expect(database.close).toHaveBeenCalledTimes(1)
  })

  it('aborts a pending cache read when its caller is cancelled', async () => {
    const { transactions } = stubIndexedDb({ deferTransactionCompletion: true })
    const cache = new ModelCache(createStatusPanel())
    const controller = new AbortController()
    const promise = cache.getCached(controller.signal)
    await vi.waitFor(() => expect(transactions).toHaveLength(1))

    controller.abort()

    await expect(promise).rejects.toThrow('模型缓存操作已取消')
    expect(transactions[0]!.abort).toHaveBeenCalledTimes(1)
  })

  it('bounds a pending cache read by the caller deadline', async () => {
    const { transactions } = stubIndexedDb({ deferTransactionCompletion: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new ModelCache(createStatusPanel())
    const promise = cache.getCached(undefined, Date.now() + 30)
    await vi.waitFor(() => expect(transactions).toHaveLength(1))

    await expect(promise).resolves.toBeNull()
    expect(transactions[0]!.abort).toHaveBeenCalledTimes(1)
  })

  it('rejects a pending cache read when close is called instead of reporting a cache miss', async () => {
    const { transactions } = stubIndexedDb({ deferTransactionCompletion: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new ModelCache(createStatusPanel())
    const promise = cache.getCached()
    await vi.waitFor(() => expect(transactions).toHaveLength(1))

    cache.close()

    await expect(promise).rejects.toThrow('模型缓存操作已取消')
    expect(transactions[0]!.abort).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight download across concurrent callers', async () => {
    const downloadModelImpl = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
    const panel = createStatusPanel()
    const cache = new ModelCache(panel, downloadModelImpl)

    const [first, second] = await Promise.all([cache.download(undefined, false), cache.download(undefined, false)])

    expect(first.byteLength).toBe(3)
    expect(second).toBe(first)
    expect(downloadModelImpl).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a finished download for later callers', async () => {
    const downloadModelImpl = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
    const cache = new ModelCache(createStatusPanel(), downloadModelImpl)

    await cache.download(undefined, false)
    await cache.download(undefined, false)

    expect(downloadModelImpl).toHaveBeenCalledTimes(2)
  })

  it('keeps distinct access key overrides on separate downloads', async () => {
    const downloadModelImpl = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
    const cache = new ModelCache(createStatusPanel(), downloadModelImpl)

    await Promise.all([cache.download(undefined, false, 'key-a'), cache.download(undefined, false, 'key-b')])

    expect(downloadModelImpl).toHaveBeenCalledTimes(2)
  })

  it('reports elapsed time when download completes', async () => {
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)

    const buffer = await cache.download(undefined, false)

    expect(buffer.byteLength).toBeGreaterThan(0)
    expect(panel.setStatus).toHaveBeenCalledWith({ model: '下载中' })
    expect(panel.setStatus).toHaveBeenCalledWith({ model: expect.stringMatching(/^下载完成 \d+ms$/) })
  })

  it('forwards access key overrides to model downloads', async () => {
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)
    const signal = new AbortController().signal
    vi.mocked(downloadModel).mockClear()

    await cache.download(signal, false, ' candidate-token ')

    expect(downloadModel).toHaveBeenCalledTimes(1)
    expect(downloadModel).toHaveBeenCalledWith(signal, {
      accessKeyOverride: ' candidate-token ',
      verifyIntegrity: false,
    })
  })

  it('confirms quota usage only after the cache transaction completes', async () => {
    const { transactions } = stubIndexedDb({ deferTransactionCompletion: true })
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)
    const buffer = bufferFromBytes([9, 9, 9])
    const confirmDownload = vi.mocked(confirmCachedModelDownload)
    confirmDownload.mockClear()
    const writePromise = cache.putCached(buffer, false)

    await vi.waitFor(() => expect(transactions).toHaveLength(1))
    expect(confirmDownload).not.toHaveBeenCalled()
    transactions[0]!.oncomplete?.(new Event('complete'))

    await expect(writePromise).resolves.toBeUndefined()

    expect(confirmDownload).toHaveBeenCalledWith(buffer, undefined)
    expect(panel.setStatus).toHaveBeenCalledWith({ model: expect.stringMatching(/^已缓存 \d+ms$/) })
  })

  it('rejects bad model buffers when cache write verification is enabled by default', async () => {
    stubIndexedDb()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new ModelCache(createStatusPanel())

    await expect(cache.putCached(bufferFromBytes([9, 9, 9]))).rejects.toThrow('缓存写入模型大小校验失败')
  })

  it('does not reject bad model buffers when cache write verification is explicitly disabled', async () => {
    stubIndexedDb()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new ModelCache(createStatusPanel())

    await expect(cache.putCached(bufferFromBytes([9, 9, 9]), false)).resolves.toBeUndefined()
  })

  it('skips cache integrity verification when caller marks cache data as already verified', async () => {
    stubIndexedDb()
    const cache = new ModelCache(createStatusPanel())
    const verifyIntegrity = vi.mocked(verifyModelIntegrity)
    verifyIntegrity.mockClear()

    await expect(cache.putCached(bufferFromBytes([9, 9, 9]), true, true)).resolves.toBeUndefined()

    expect(verifyIntegrity).not.toHaveBeenCalled()
  })

  it('aborts an active cache write when its signal is cancelled', async () => {
    const { transactions } = stubIndexedDb({ deferTransactionCompletion: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)
    const controller = new AbortController()
    const writePromise = cache.putCached(bufferFromBytes([9, 9, 9]), false, false, controller.signal)
    await vi.waitFor(() => expect(transactions).toHaveLength(1))

    controller.abort()

    await expect(writePromise).rejects.toThrow('模型缓存操作已取消')
    expect(transactions[0]!.abort).toHaveBeenCalledTimes(1)
    expect(panel.setStatus).not.toHaveBeenCalledWith({ model: expect.stringMatching(/^已缓存/) })
  })

  it('aborts active cache writes before close returns', async () => {
    const { transactions } = stubIndexedDb({ deferTransactionCompletion: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new ModelCache(createStatusPanel())
    const writePromise = cache.putCached(bufferFromBytes([9, 9, 9]), false)
    await vi.waitFor(() => expect(transactions).toHaveLength(1))

    cache.close()

    await expect(writePromise).rejects.toThrow('模型缓存操作已取消')
    expect(transactions[0]!.abort).toHaveBeenCalledTimes(1)
  })
})

describe('createCachedModelRow', () => {
  it('creates cache rows only for buffers that pass integrity verification by default', async () => {
    await expect(
      createCachedModelRow(bufferFromBytes([1, 2, 3]), { integrity: TEST_INTEGRITY }),
    ).resolves.toMatchObject({
      key: modelConfig.cacheKey,
      version: modelConfig.version,
      byteLength: TEST_INTEGRITY.byteLength,
      sha256: TEST_INTEGRITY.sha256,
    })
  })

  it('rejects cache rows for buffers with unexpected integrity by default', async () => {
    await expect(createCachedModelRow(bufferFromBytes([9, 9, 9]), { integrity: TEST_INTEGRITY })).rejects.toThrow(
      '缓存写入模型 SHA-256 校验失败',
    )
  })

  it('creates cache rows without integrity checks when explicitly disabled', async () => {
    await expect(
      createCachedModelRow(bufferFromBytes([9, 9, 9]), { integrity: TEST_INTEGRITY, verifyIntegrity: false }),
    ).resolves.toMatchObject({
      key: modelConfig.cacheKey,
      version: modelConfig.version,
      byteLength: TEST_INTEGRITY.byteLength,
      sha256: TEST_INTEGRITY.sha256,
    })
  })
})
