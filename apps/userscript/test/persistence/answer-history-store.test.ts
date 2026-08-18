import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HISTORY_KEY } from '../../src/persistence/answer-history-config'
import { HistoryStore } from '../../src/persistence/answer-history-store'
import type { HistoryRecord } from '../../src/persistence/answer-history-types'

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

    expect(records).toEqual([validSuccessRecord, validManualRecord])
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
  })

  it('drops invalid existing records when adding a new record', async () => {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({
        main: [null, { type: 'random', answers: 42, elapsed: 1, message: 'bad' }, validErrorRecord],
      }),
    )
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
    const saved = JSON.parse(raw ?? '{}') as { main?: unknown[] }
    expect(saved.main).toHaveLength(2)
    expect(saved.main?.[0]).toMatchObject(newRecord)
    expect(saved.main?.[1]).toEqual(validErrorRecord)
  })
})
