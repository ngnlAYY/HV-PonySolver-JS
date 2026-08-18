import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HISTORY_ENTRY_PREFIX, HISTORY_KEY } from '../../src/persistence/answer-history-config'
import { HistoryStore } from '../../src/persistence/answer-history-store'
import type { HistoryRecord } from '../../src/persistence/answer-history-types'
import type { EnumerableTextStorage } from '../../src/platform/storage'

class MemoryEnumerableStorage implements EnumerableTextStorage {
  readonly values = new Map<string, string>()
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

  removeItem(key: string): void {
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

  it('uses individual keys for enumerable storage and removes a corrupted legacy root', async () => {
    const storage = new MemoryEnumerableStorage()
    storage.values.set(HISTORY_KEY, '{bad json')
    storage.values.set(`${HISTORY_ENTRY_PREFIX}main:invalid`, '{bad entry')
    const store = new HistoryStore(storage, () => 'new-record')

    const mutation = store.add('main', { type: 'success', answers: 'TS', elapsed: 12 })
    await expect(mutation.persisted).resolves.toMatchObject([{ answers: 'TS' }])

    expect(storage.values.has(HISTORY_KEY)).toBe(false)
    expect(storage.values.has(`${HISTORY_ENTRY_PREFIX}main:new-record`)).toBe(true)
    expect(store.get('main')).toMatchObject([{ answers: 'TS' }])
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
