import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCachedModelRow, ModelCache, readCachedModelBuffer } from '../../src/model/model-cache'
import { modelConfig } from '../../src/model/model-config'
import type { StatusPanel } from '../../src/status-panel/status-panel-types'

const TEST_SHA256 = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
const TEST_INTEGRITY = { byteLength: 3, sha256: TEST_SHA256 } as const

type TestObjectStore = Pick<IDBObjectStore, 'put'>
type TestTransaction = Pick<IDBTransaction, 'objectStore' | 'onabort' | 'oncomplete' | 'onerror' | 'error'>
type TestOpenRequest = Pick<IDBOpenDBRequest, 'onerror' | 'onsuccess' | 'onupgradeneeded' | 'result' | 'error'>
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

function stubIndexedDb(): void {
  const objectStore: TestObjectStore = {
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
      return transaction as IDBTransaction
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
      return request as IDBOpenDBRequest
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

    await expect(readCachedModelBuffer({
      key: modelConfig.cacheKey,
      version: modelConfig.version,
      byteLength: TEST_INTEGRITY.byteLength,
      sha256: TEST_INTEGRITY.sha256,
      buffer,
    }, { integrity: TEST_INTEGRITY }))
      .resolves.toBe(buffer)
  })

  it('ignores cached buffers with mismatched integrity by default', async () => {
    await expect(readCachedModelBuffer({
      key: modelConfig.cacheKey,
      version: modelConfig.version,
      byteLength: 1,
      sha256: TEST_INTEGRITY.sha256,
      buffer: bufferFromBytes([9]),
    }, { integrity: TEST_INTEGRITY }))
      .resolves.toBeNull()
  })

  it('ignores cached buffers with forged integrity metadata by default', async () => {
    await expect(readCachedModelBuffer({
      key: modelConfig.cacheKey,
      version: modelConfig.version,
      byteLength: TEST_INTEGRITY.byteLength,
      sha256: TEST_INTEGRITY.sha256,
      buffer: bufferFromBytes([9, 9, 9]),
    }, { integrity: TEST_INTEGRITY }))
      .resolves.toBeNull()
  })

  it('returns cached buffers without integrity checks when explicitly disabled', async () => {
    const buffer = bufferFromBytes([9, 9, 9])

    await expect(readCachedModelBuffer({
      key: modelConfig.cacheKey,
      version: modelConfig.version,
      byteLength: 1,
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
      buffer,
    }, { integrity: TEST_INTEGRITY, verifyIntegrity: false }))
      .resolves.toBe(buffer)
  })
})

describe('ModelCache', () => {
  it('rejects bad model buffers when cache write verification is enabled by default', async () => {
    stubIndexedDb()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new ModelCache(createStatusPanel())

    await expect(cache.putCached(bufferFromBytes([9, 9, 9])))
      .rejects.toThrow('缓存写入模型大小校验失败')
  })

  it('does not reject bad model buffers when cache write verification is explicitly disabled', async () => {
    stubIndexedDb()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = new ModelCache(createStatusPanel())

    await expect(cache.putCached(bufferFromBytes([9, 9, 9]), false))
      .resolves.toBeUndefined()
  })
})

describe('createCachedModelRow', () => {
  it('creates cache rows only for buffers that pass integrity verification by default', async () => {
    await expect(createCachedModelRow(bufferFromBytes([1, 2, 3]), { integrity: TEST_INTEGRITY }))
      .resolves.toMatchObject({
        key: modelConfig.cacheKey,
        version: modelConfig.version,
        byteLength: TEST_INTEGRITY.byteLength,
        sha256: TEST_INTEGRITY.sha256,
      })
  })

  it('rejects cache rows for buffers with unexpected integrity by default', async () => {
    await expect(createCachedModelRow(bufferFromBytes([9, 9, 9]), { integrity: TEST_INTEGRITY }))
      .rejects.toThrow('缓存写入模型 SHA-256 校验失败')
  })

  it('creates cache rows without integrity checks when explicitly disabled', async () => {
    await expect(createCachedModelRow(bufferFromBytes([9, 9, 9]), { integrity: TEST_INTEGRITY, verifyIntegrity: false }))
      .resolves.toMatchObject({
        key: modelConfig.cacheKey,
        version: modelConfig.version,
        byteLength: TEST_INTEGRITY.byteLength,
        sha256: TEST_INTEGRITY.sha256,
      })
  })
})
