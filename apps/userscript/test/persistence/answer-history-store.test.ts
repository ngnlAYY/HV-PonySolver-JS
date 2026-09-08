import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  HISTORY_ENTRY_PREFIX,
  HISTORY_KEY,
  type HistoryMutation,
  type HistoryRecord,
} from '@hv-pony-solver/browser-core'
import { HistoryStore } from '../../src/persistence/answer-history-store'
import { userscriptHistoryStorage } from '../../src/userscript/gm-storage'

const validSuccessRecord: HistoryRecord = {
  type: 'success',
  answers: 'TS(99.9)',
  elapsed: 123,
  timestamp: 1,
  time: '12:00:00',
}

const validManualRecord: HistoryRecord = {
  type: 'manual',
  answers: 'RA(98.0)',
  elapsed: 234,
  timestamp: 2,
  time: '12:00:01',
}

const validErrorRecord: HistoryRecord = {
  type: 'error',
  elapsed: 456,
  message: '识别失败',
}

describe('HistoryStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('filters invalid localStorage records without throwing', () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({
        main: [
          null,
          'bad',
          { type: 'success', answers: 'TS', elapsed: 'fast', message: '' },
          { type: 'noop', answers: 'TS', elapsed: 1, message: '' },
          { type: 'manual', answers: 42, elapsed: 1 },
          validSuccessRecord,
          validManualRecord,
        ],
      }),
    )

    const records = new HistoryStore().get('main')

    expect(records).toEqual([validManualRecord, validSuccessRecord])
  })

  it('returns an empty list for corrupted JSON', () => {
    localStorage.setItem(HISTORY_KEY, '{bad json')

    const records = new HistoryStore().get('main')

    expect(records).toEqual([])
  })

  it('keeps up to fifty records when adding answers', async () => {
    const store = new HistoryStore()
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
    expect(userscriptHistoryStorage.getItemsByPrefix(HISTORY_ENTRY_PREFIX)).toHaveLength(50)
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
  })

  it.each(['main', 'isekai'] as const)(
    'keeps both records when another tab writes to %s between the first read and write',
    async (secondWorld) => {
      const firstStore = new HistoryStore()
      const secondStore = new HistoryStore()
      const nativeSet = localStorage.setItem.bind(localStorage)
      let secondMutation: HistoryMutation | undefined
      vi.spyOn(localStorage, 'setItem').mockImplementationOnce((key, value) => {
        secondMutation = secondStore.add(secondWorld, { type: 'success', answers: 'RA', elapsed: 20 })
        nativeSet(key, value)
      })

      const firstMutation = firstStore.add('main', { type: 'success', answers: 'TS', elapsed: 10 })
      expect(secondMutation).toBeDefined()
      await firstMutation.persisted
      await secondMutation?.persisted

      const freshStore = new HistoryStore()
      const records = [...freshStore.get('main'), ...freshStore.get('isekai')]
      expect(records.map((record) => (record.type === 'error' ? record.message : record.answers)).sort()).toEqual([
        'RA',
        'TS',
      ])
      expect(userscriptHistoryStorage.getItemsByPrefix(HISTORY_ENTRY_PREFIX)).toHaveLength(2)
      expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
    },
  )

  it('enumerates only history values and tolerates a record removed after the key snapshot', () => {
    const firstKey = `${HISTORY_ENTRY_PREFIX}main:first`
    const removedKey = `${HISTORY_ENTRY_PREFIX}main:removed`
    localStorage.setItem(firstKey, 'first')
    localStorage.setItem(removedKey, 'removed')
    localStorage.setItem('unrelated-setting', 'untouched')
    const nativeGet = localStorage.getItem.bind(localStorage)
    const get = vi.spyOn(localStorage, 'getItem').mockImplementation((key) => {
      if (key === firstKey) localStorage.removeItem(removedKey)
      return nativeGet(key)
    })

    expect(userscriptHistoryStorage.getItemsByPrefix(HISTORY_ENTRY_PREFIX)).toEqual([[firstKey, 'first']])
    expect(get).not.toHaveBeenCalledWith('unrelated-setting')
  })

  it('deduplicates keys and skips missing indices during concurrent enumeration', () => {
    const entryKey = `${HISTORY_ENTRY_PREFIX}main:first`
    localStorage.setItem(entryKey, 'first')
    localStorage.setItem('unrelated-a', 'a')
    localStorage.setItem('unrelated-b', 'b')
    vi.spyOn(localStorage, 'key').mockReturnValueOnce(entryKey).mockReturnValueOnce(entryKey).mockReturnValueOnce(null)

    expect(userscriptHistoryStorage.getItemsByPrefix(HISTORY_ENTRY_PREFIX)).toEqual([[entryKey, 'first']])
  })

  it('reports unavailable storage instead of treating it as an empty history', () => {
    vi.stubGlobal('localStorage', undefined)
    try {
      expect(() => userscriptHistoryStorage.getItemsByPrefix(HISTORY_ENTRY_PREFIX)).toThrow('localStorage 不可用')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('filters legacy records without rewriting their root when adding a keyed record', async () => {
    const legacyRaw = JSON.stringify({
      main: [null, { type: 'random', answers: 42, elapsed: 1, message: 'bad' }, validErrorRecord],
    })
    localStorage.setItem(HISTORY_KEY, legacyRaw)
    const newRecord: HistoryRecord = {
      type: 'success',
      answers: 'RA(88.8)',
      elapsed: 99,
    }

    const mutation = new HistoryStore().add('main', newRecord)
    const records = mutation.records
    await mutation.persisted

    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject(newRecord)

    const raw = localStorage.getItem(HISTORY_KEY)
    expect(raw).not.toBeNull()
    expect(raw).toBe(legacyRaw)
    const entries = userscriptHistoryStorage.getItemsByPrefix(HISTORY_ENTRY_PREFIX)
    expect(entries).toHaveLength(1)
    expect(JSON.parse(entries[0]?.[1] ?? '{}')).toMatchObject(newRecord)
    expect(new HistoryStore().get('main')).toMatchObject([newRecord, validErrorRecord])
  })
})
