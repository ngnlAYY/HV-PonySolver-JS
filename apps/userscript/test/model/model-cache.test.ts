import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/model/model-downloader', () => ({
  downloadModel: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
}))
vi.mock('../../src/model/model-integrity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/model/model-integrity')>()
  return {
    ...actual,
    verifyModelIntegrity: vi.fn(actual.verifyModelIntegrity),
  }
})

import { createCachedModelRow, ModelCache, readCachedModelBuffer } from '../../src/model/model-cache'
import { verifyModelIntegrity } from '../../src/model/model-integrity'
import { modelConfig } from '../../src/model/model-config'
import type { StatusPanel } from '../../src/status-panel/status-panel-types'

const TEST_SHA256 = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
const TEST_INTEGRITY = { byteLength: 3, sha256: TEST_SHA256 } as const

type TestObjectStore = Pick<IDBObjectStore, 'get' | 'put'>
type TestTransaction = {
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
    addRandomFailure: vi.fn(),
    addError: vi.fn(),
    create: vi.fn(),
    destroy: vi.fn(),
  }
}

function stubIndexedDb(cachedRow?: Record<string, unknown>, readError?: DOMException): void {
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
        objectStore: vi.fn(() => objectStore as IDBObjectStore),
        onabort: null,
        oncomplete: null,
        onerror: null,
        error: null,
      }
      queueMicrotask(() => transaction.oncomplete?.(new Event('complete')))
      return transaction as unknown as IDBTransaction
    }),
  }
  const request: TestOpenRequest = {
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
    result: database as IDBDatabase,
    error: null,
  }
  const indexedDb = {
    open: vi.fn(() => {
      queueMicrotask(() => {
        request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
        request.onsuccess?.(new Event('success'))
      })
      return request as unknown as IDBOpenDBRequest
    }),
  }

  vi.stubGlobal('indexedDB', indexedDb)
}

afterEach(() => {
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
      key: modelConfig.cacheKey,
      version: modelConfig.version,
      byteLength: modelConfig.integrity.byteLength,
      sha256: modelConfig.integrity.sha256,
      buffer,
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
    stubIndexedDb(undefined, new DOMException('读取失败'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)

    await expect(cache.getCached()).resolves.toBeNull()

    expect(panel.setStatus).toHaveBeenCalledWith({ model: expect.stringMatching(/^缓存读取失败 \d+ms，准备下载$/) })
  })

  it('reports elapsed time when download completes', async () => {
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)

    const buffer = await cache.download(undefined, false)

    expect(buffer.byteLength).toBeGreaterThan(0)
    expect(panel.setStatus).toHaveBeenCalledWith({ model: '下载中' })
    expect(panel.setStatus).toHaveBeenCalledWith({ model: expect.stringMatching(/^下载完成 \d+ms$/) })
  })

  it('reports elapsed time when cache write completes', async () => {
    stubIndexedDb()
    const panel = createStatusPanel()
    const cache = new ModelCache(panel)

    await expect(cache.putCached(bufferFromBytes([9, 9, 9]), false)).resolves.toBeUndefined()

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
