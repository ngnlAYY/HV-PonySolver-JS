import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { INDEXED_DB_OPEN_TIMEOUT_MS, IndexedDbStringStorage } from '../../src/host/indexeddb-string-storage'

type TestTransaction = {
  abort: ReturnType<typeof vi.fn>
  error: DOMException | null
  objectStore(name: string): IDBObjectStore
  onabort: ((event: Event) => void) | null
  oncomplete: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
}

function installIndexedDb(
  options: Readonly<{
    deferredOpen?: boolean
    getValue?: string
    storeExists?: boolean
    autoGetSuccess?: boolean
  }> = {},
): Readonly<{
  database: IDBDatabase
  objectStore: IDBObjectStore
  openRequest: IDBOpenDBRequest
  requestResult: IDBRequest
  transactions: TestTransaction[]
}> {
  const transactions: TestTransaction[] = []
  const requestResult = {
    error: null,
    result: options.getValue === undefined ? undefined : { key: 'key', value: options.getValue },
    onerror: null,
    onsuccess: null,
  } as unknown as IDBRequest
  const objectStore = {
    get: vi.fn(() => {
      if (options.autoGetSuccess ?? true) {
        queueMicrotask(() => requestResult.onsuccess?.(new Event('success')))
      }
      return requestResult
    }),
    put: vi.fn(),
    delete: vi.fn(),
  } as unknown as IDBObjectStore
  const database = {
    close: vi.fn(),
    createObjectStore: vi.fn(),
    objectStoreNames: { contains: vi.fn(() => options.storeExists ?? true) },
    onversionchange: null,
    transaction: vi.fn(() => {
      const transaction: TestTransaction = {
        error: null,
        objectStore: vi.fn(() => objectStore),
        onabort: null,
        oncomplete: null,
        onerror: null,
        abort: vi.fn(() => {
          queueMicrotask(() => transaction.onabort?.(new Event('abort')))
        }),
      }
      transactions.push(transaction)
      return transaction as unknown as IDBTransaction
    }),
  } as unknown as IDBDatabase
  const openRequest = {
    error: null,
    result: database,
    onblocked: null,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
  } as unknown as IDBOpenDBRequest
  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => {
      if (!options.deferredOpen) {
        queueMicrotask(() => openRequest.onsuccess?.(new Event('success')))
      }
      return openRequest
    }),
  })
  return { database, objectStore, openRequest, requestResult, transactions }
}

async function waitForTransaction(transactions: TestTransaction[], index = 0): Promise<TestTransaction> {
  await vi.waitFor(() => expect(transactions.length).toBeGreaterThan(index))
  return transactions[index]!
}

function complete(transaction: TestTransaction): void {
  transaction.oncomplete?.(new Event('complete'))
}

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('IndexedDbStringStorage', () => {
  it('reads, writes and removes string values through one reusable database', async () => {
    const { database, objectStore, transactions } = installIndexedDb({ getValue: 'stored' })
    const storage = new IndexedDbStringStorage()

    const readPromise = storage.get('key')
    complete(await waitForTransaction(transactions, 0))
    await expect(readPromise).resolves.toBe('stored')
    expect(objectStore.get).toHaveBeenCalledWith('key')

    const writePromise = storage.set('key', 'next')
    complete(await waitForTransaction(transactions, 1))
    await expect(writePromise).resolves.toBeUndefined()
    expect(objectStore.put).toHaveBeenCalledWith({ key: 'key', value: 'next' })

    const removePromise = storage.remove('key')
    complete(await waitForTransaction(transactions, 2))
    await expect(removePromise).resolves.toBeUndefined()
    expect(objectStore.delete).toHaveBeenCalledWith('key')
    expect(database.transaction).toHaveBeenCalledTimes(3)
    expect(indexedDB.open).toHaveBeenCalledTimes(1)

    await storage.close()
    await storage.close()
    expect(database.close).toHaveBeenCalledTimes(1)
  })

  it('returns null for a missing row and creates the store during first upgrade', async () => {
    const { database, openRequest, transactions } = installIndexedDb({
      deferredOpen: true,
      storeExists: false,
    })
    const storage = new IndexedDbStringStorage()
    const readPromise = storage.get('missing')

    openRequest.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent)
    openRequest.onsuccess?.(new Event('success'))
    complete(await waitForTransaction(transactions))

    await expect(readPromise).resolves.toBeNull()
    expect(database.createObjectStore).toHaveBeenCalledWith('values', { keyPath: 'key' })
  })

  it('closes and rejects an open that resolves after close', async () => {
    const { database, openRequest } = installIndexedDb({ deferredOpen: true })
    const storage = new IndexedDbStringStorage()
    const readPromise = storage.get('key')
    const closePromise = storage.close()

    openRequest.onsuccess?.(new Event('success'))

    await expect(readPromise).rejects.toThrow('扩展 Key 数据库已关闭')
    await expect(closePromise).resolves.toBeUndefined()
    expect(database.close).toHaveBeenCalledTimes(1)
    expect(database.transaction).not.toHaveBeenCalled()
  })

  it('closes a database delivered after blocked, aborted, or timed-out open settlement', async () => {
    const blocked = installIndexedDb({ deferredOpen: true })
    const blockedStorage = new IndexedDbStringStorage()
    const blockedRead = blockedStorage.get('key')
    blocked.openRequest.onblocked?.(new Event('blocked') as IDBVersionChangeEvent)
    await expect(blockedRead).rejects.toThrow('扩展 Key 数据库升级被阻止')
    blocked.openRequest.onsuccess?.(new Event('success'))
    expect(blocked.database.close).toHaveBeenCalledTimes(1)

    const aborted = installIndexedDb({ deferredOpen: true })
    const abortedStorage = new IndexedDbStringStorage()
    const controller = new AbortController()
    const abortedRead = abortedStorage.get('key', controller.signal)
    controller.abort()
    await expect(abortedRead).rejects.toThrow('扩展 Key 存储操作已取消')
    aborted.openRequest.onsuccess?.(new Event('success'))
    expect(aborted.database.close).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    const timedOut = installIndexedDb({ deferredOpen: true })
    const timedOutStorage = new IndexedDbStringStorage()
    const timedOutRead = timedOutStorage.get('key')
    const timedOutRejection = expect(timedOutRead).rejects.toThrow('IndexedDB 打开超时')
    await vi.advanceTimersByTimeAsync(INDEXED_DB_OPEN_TIMEOUT_MS)
    await timedOutRejection
    timedOut.openRequest.onsuccess?.(new Event('success'))
    expect(timedOut.database.close).toHaveBeenCalledTimes(1)
  })

  it('aborts a writable transaction when its signal is cancelled', async () => {
    const { transactions } = installIndexedDb()
    const storage = new IndexedDbStringStorage()
    const controller = new AbortController()
    const writePromise = storage.set('key', 'value', controller.signal)
    await vi.waitFor(() => expect(transactions).toHaveLength(1))

    controller.abort()

    await expect(writePromise).rejects.toThrow('扩展 Key 存储操作已取消')
    expect(transactions[0]!.abort).toHaveBeenCalledTimes(1)
  })

  it('rejects already-cancelled operations before opening IndexedDB', async () => {
    installIndexedDb()
    const storage = new IndexedDbStringStorage()
    const controller = new AbortController()
    controller.abort()

    await expect(storage.get('key', controller.signal)).rejects.toThrow('扩展 Key 存储操作已取消')
    await expect(storage.set('key', 'value', controller.signal)).rejects.toThrow('扩展 Key 存储操作已取消')
    await expect(storage.remove('key', controller.signal)).rejects.toThrow('扩展 Key 存储操作已取消')
    expect(indexedDB.open).not.toHaveBeenCalled()
  })

  it('rejects open errors and blocked upgrades and retries with a fresh open request', async () => {
    const first = installIndexedDb({ deferredOpen: true })
    const storage = new IndexedDbStringStorage()
    const firstRead = storage.get('key')
    first.openRequest.onerror?.(new Event('error'))
    await expect(firstRead).rejects.toThrow('无法打开扩展 Key 数据库')

    const second = installIndexedDb({ deferredOpen: true })
    const blockedRead = storage.get('key')
    second.openRequest.onblocked?.(new Event('blocked') as IDBVersionChangeEvent)
    await expect(blockedRead).rejects.toThrow('扩展 Key 数据库升级被阻止')
  })

  it('propagates request, transaction error and unowned abort failures', async () => {
    const first = installIndexedDb({ autoGetSuccess: false })
    const storage = new IndexedDbStringStorage()
    const readPromise = storage.get('key')
    const readTransaction = await waitForTransaction(first.transactions)
    first.requestResult.onerror?.(new Event('error'))
    complete(readTransaction)
    await expect(readPromise).rejects.toThrow('IndexedDB 请求失败')

    const writePromise = storage.set('key', 'value')
    const writeTransaction = await waitForTransaction(first.transactions, 1)
    writeTransaction.onerror?.(new Event('error'))
    await expect(writePromise).rejects.toThrow('IndexedDB 事务失败')

    const removePromise = storage.remove('key')
    const removeTransaction = await waitForTransaction(first.transactions, 2)
    removeTransaction.onabort?.(new Event('abort'))
    await expect(removePromise).rejects.toThrow('IndexedDB 事务已中止')
  })

  it('converts an abort exception into a cancellation error', async () => {
    const { transactions } = installIndexedDb()
    const storage = new IndexedDbStringStorage()
    const controller = new AbortController()
    const writePromise = storage.set('key', 'value', controller.signal)
    const transaction = await waitForTransaction(transactions)
    transaction.abort.mockImplementationOnce(() => {
      throw new DOMException('already settled', 'InvalidStateError')
    })

    controller.abort()

    await expect(writePromise).rejects.toThrow('扩展 Key 存储操作已取消')
  })

  it('aborts an active write before closing the database', async () => {
    const { database, transactions } = installIndexedDb()
    const storage = new IndexedDbStringStorage()
    const writePromise = storage.set('key', 'value')
    await vi.waitFor(() => expect(transactions).toHaveLength(1))

    const closePromise = storage.close()

    await expect(writePromise).rejects.toThrow('扩展 Key 数据库已关闭')
    await expect(closePromise).resolves.toBeUndefined()
    expect(transactions[0]!.abort).toHaveBeenCalledTimes(1)
    expect(database.close).toHaveBeenCalledTimes(1)
  })

  it('closes automatically on version change and reopens for later operations', async () => {
    const first = installIndexedDb({ getValue: 'first' })
    const storage = new IndexedDbStringStorage()
    const firstRead = storage.get('key')
    complete(await waitForTransaction(first.transactions))
    await expect(firstRead).resolves.toBe('first')

    first.database.onversionchange?.(new Event('versionchange') as IDBVersionChangeEvent)
    await vi.waitFor(() => expect(first.database.close).toHaveBeenCalled())

    const second = installIndexedDb({ getValue: 'second' })
    const secondRead = storage.get('key')
    complete(await waitForTransaction(second.transactions))
    await expect(secondRead).resolves.toBe('second')
  })
})
