import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HISTORY_ENTRY_PREFIX, HISTORY_KEY } from '../../src/persistence/answer-history-config'
import { HistoryStore } from '../../src/persistence/answer-history-store'
import type { HistoryRecord } from '../../src/persistence/answer-history-types'
import type { EnumerableTextStorage } from '../../src/platform/storage'

class MemoryEnumerableStorage implements EnumerableTextStorage {
  readonly values = new Map<string, string>()
  readonly rejectRemoveKeys = new Set<string>()
  rejectNextSet: Error | null = null

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void | Promise<void> {
    if (this.rejectNextSet) {
      const error = this.rejectNextSet
      this.rejectNextSet = null
      return Promise.reject(error)
    }
    this.values.set(key, value)
  }

  removeItem(key: string): void | Promise<void> {
    if (this.rejectRemoveKeys.has(key)) {
      return Promise.reject(new Error(`remove failed: ${key}`))
    }
    this.values.delete(key)
  }

  getItemsByPrefix(prefix: string): ReadonlyArray<readonly [key: string, value: string]> {
    return Array.from(this.values.entries()).filter(([key]) => key.startsWith(prefix))
  }
}

const validSuccessRecord: HistoryRecord = {
  type: 'success',
  answers: 'TS(99.9)',
  elapsed: 123,
  timestamp: 1,
  time: '12:00:00',
}

const validManualRecord: HistoryRecord = {
  type: 'manual',
  answers: 'RA(88.8)',
  elapsed: 99,
  timestamp: 2,
  time: '12:00:01',
}

const validErrorRecord: HistoryRecord = {
  type: 'error',
  elapsed: 456,
  message: '识别失败',
  timestamp: 2,
}

describe('HistoryStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('filters invalid legacy records without throwing', () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({
        main: [
          null,
          'bad',
          { type: 'success', answers: 'TS', elapsed: 'fast' },
          { type: 'noop', answers: 'TS', elapsed: 1 },
          validSuccessRecord,
          validErrorRecord,
        ],
      }),
    )

    expect(new HistoryStore(localStorage).get('main')).toEqual([validSuccessRecord, validErrorRecord])
  })

  it('reuses unchanged parsed history and refreshes only changed values without exposing cached objects', () => {
    const storage = new MemoryEnumerableStorage()
    const key = `${HISTORY_ENTRY_PREFIX}main:cached`
    storage.values.set(key, JSON.stringify(validSuccessRecord))
    storage.values.set(HISTORY_KEY, JSON.stringify({ main: [validManualRecord] }))
    const store = new HistoryStore(storage)
    const parse = vi.spyOn(JSON, 'parse')
    const initial = store.get('main')
    const firstParseCount = parse.mock.calls.length
    initial[0]!.elapsed = 999
    expect(store.get('main')[0]?.elapsed).toBe(validManualRecord.elapsed)
    expect(parse.mock.calls.length).toBe(firstParseCount)
    storage.values.set(key, JSON.stringify({ ...validSuccessRecord, answers: 'changed' }))
    expect(store.get('main')).toContainEqual({ ...validSuccessRecord, answers: 'changed' })
    expect(parse.mock.calls.length).toBe(firstParseCount + 1)
    storage.values.delete(key)
    expect(store.get('main')).toEqual([validManualRecord])
    parse.mockRestore()
  })

  it('self-heals corrupted legacy JSON when adding a record', async () => {
    localStorage.setItem(HISTORY_KEY, '{bad json')
    const store = new HistoryStore(localStorage)

    const mutation = store.add('main', {
      type: 'success',
      answers: 'RA(88.8)',
      elapsed: 99,
    })

    expect(mutation.records[0]).toMatchObject({ answers: 'RA(88.8)', elapsed: 99 })
    await expect(mutation.persisted).resolves.toMatchObject([{ answers: 'RA(88.8)' }])
    const repaired = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '') as { main: HistoryRecord[] }
    expect(repaired.main).toHaveLength(1)
    expect(repaired.main[0]).toMatchObject({ answers: 'RA(88.8)', elapsed: 99 })
  })

  it('keeps up to fifty legacy records', async () => {
    const store = new HistoryStore(localStorage)
    const persisted: Promise<HistoryRecord[]>[] = []
    for (let index = 0; index < 51; index += 1) {
      persisted.push(
        store.add('main', {
          type: 'success',
          answers: `P${index}`,
          elapsed: index,
        }).persisted,
      )
    }
    await Promise.all(persisted)

    const records = store.get('main')
    expect(records).toHaveLength(50)
    expect(records[0]).toMatchObject({ answers: 'P50' })
    expect(records[49]).toMatchObject({ answers: 'P1' })
  })

  it('caps oversized legacy storage on read without requiring another write', () => {
    const records = Array.from({ length: 51 }, (_, index) => ({
      type: 'success',
      answers: `P${index}`,
      elapsed: index,
    }))
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ main: records }))

    expect(new HistoryStore(localStorage).get('main')).toEqual(records.slice(0, 50))
  })

  it('drops records whose persisted text fields exceed the defensive bound', () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({
        main: [
          validSuccessRecord,
          { type: 'success', answers: 'x'.repeat(1_025), elapsed: 1 },
          { type: 'error', message: 'x'.repeat(1_025), elapsed: 1 },
        ],
      }),
    )

    expect(new HistoryStore(localStorage).get('main')).toEqual([validSuccessRecord])
  })

  it('bounds text before exposing or persisting a new record', async () => {
    const storage = new MemoryEnumerableStorage()
    const store = new HistoryStore(storage, () => 'bounded-record')
    const oversizedMessage = '错'.repeat(1_025)

    const mutation = store.add('main', { type: 'error', message: oversizedMessage, elapsed: 1 })

    expect(mutation.records[0]).toMatchObject({ message: oversizedMessage.slice(0, 1_024) })
    await mutation.persisted
    const persisted = JSON.parse(
      storage.values.get(`${HISTORY_ENTRY_PREFIX}main:bounded-record`) ?? '',
    ) as HistoryRecord
    expect(persisted).toMatchObject({ message: oversizedMessage.slice(0, 1_024) })
  })

  it('uses individual keys for enumerable storage and removes a corrupted legacy root', async () => {
    const storage = new MemoryEnumerableStorage()
    storage.values.set(HISTORY_KEY, '{bad json')
    storage.values.set(`${HISTORY_ENTRY_PREFIX}main:invalid`, '{bad entry')
    const store = new HistoryStore(storage, () => 'new-record')

    const mutation = store.add('main', { type: 'success', answers: 'TS', elapsed: 12 })
    await expect(mutation.persisted).resolves.toMatchObject([{ answers: 'TS' }])

    expect(storage.values.has(HISTORY_KEY)).toBe(false)
    expect(storage.values.has(`${HISTORY_ENTRY_PREFIX}main:invalid`)).toBe(false)
    expect(storage.values.has(`${HISTORY_ENTRY_PREFIX}main:new-record`)).toBe(true)
    expect(store.get('main')).toMatchObject([{ answers: 'TS' }])
  })

  it('falls back to legacy history when keyed enumeration fails', () => {
    const storage = new MemoryEnumerableStorage()
    storage.values.set(HISTORY_KEY, JSON.stringify({ main: [validSuccessRecord] }))
    storage.getItemsByPrefix = () => {
      throw new Error('storage mirror unavailable')
    }

    expect(new HistoryStore(storage).get('main')).toEqual([validSuccessRecord])
    expect(vi.mocked(globalThis.console.warn).mock.calls.flat().join(' ')).toContain('读取单条记录列表失败')
  })

  it('keeps a successful keyed write usable when corrupted-record cleanup fails', async () => {
    const storage = new MemoryEnumerableStorage()
    const invalidKey = `${HISTORY_ENTRY_PREFIX}main:invalid`
    storage.values.set(HISTORY_KEY, '{bad json')
    storage.values.set(invalidKey, '{bad entry')
    storage.rejectRemoveKeys.add(HISTORY_KEY)
    storage.rejectRemoveKeys.add(invalidKey)
    const store = new HistoryStore(storage, () => 'new-record')

    const mutation = store.add('main', { type: 'success', answers: 'TS', elapsed: 12 })

    await expect(mutation.persisted).resolves.toMatchObject([{ answers: 'TS' }])
    expect(storage.values.has(HISTORY_KEY)).toBe(true)
    expect(storage.values.has(invalidKey)).toBe(true)
    expect(storage.values.has(`${HISTORY_ENTRY_PREFIX}main:new-record`)).toBe(true)
    expect(vi.mocked(globalThis.console.warn).mock.calls.flat().join(' ')).toContain('清理损坏记录失败')
    expect(vi.mocked(globalThis.console.warn).mock.calls.flat().join(' ')).toContain('清理过期记录失败')
  })

  it('detects only strictly valid legacy or keyed history across both worlds', () => {
    const storage = new MemoryEnumerableStorage()
    const store = new HistoryStore(storage)
    expect(store.hasHistory()).toBe(false)

    storage.values.set(HISTORY_KEY, JSON.stringify({ main: [{ type: 'success', answers: 'TS', elapsed: 'fast' }] }))
    storage.values.set(`${HISTORY_ENTRY_PREFIX}main:invalid`, JSON.stringify({ type: 'noop', elapsed: 1 }))
    expect(store.hasHistory()).toBe(false)

    storage.values.set(`${HISTORY_ENTRY_PREFIX}isekai:valid`, JSON.stringify(validSuccessRecord))
    expect(store.hasHistory()).toBe(true)

    storage.values.delete(`${HISTORY_ENTRY_PREFIX}isekai:valid`)
    storage.values.set(HISTORY_KEY, JSON.stringify({ main: [validErrorRecord] }))
    expect(store.hasHistory()).toBe(false)

    storage.values.set(HISTORY_KEY, JSON.stringify({ isekai: [validManualRecord] }))
    expect(store.hasHistory()).toBe(true)
  })

  it('exposes persistence rejection while retaining only the optimistic return value', async () => {
    const storage = new MemoryEnumerableStorage()
    storage.rejectNextSet = new Error('quota exceeded')
    const store = new HistoryStore(storage, () => 'failed-record')

    const mutation = store.add('main', { type: 'success', answers: 'TS', elapsed: 12 })

    expect(mutation.records).toMatchObject([{ answers: 'TS' }])
    await expect(mutation.persisted).rejects.toThrow('quota exceeded')
    expect(store.get('main')).toEqual([])
  })
})
