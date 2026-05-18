import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HISTORY_KEY } from '../../src/persistence/answer-history-config'
import { HistoryStore } from '../../src/persistence/answer-history-store'
import type { HistoryRecord } from '../../src/persistence/answer-history-types'

const validSuccessRecord: HistoryRecord = {
  type: 'success',
  answers: 'TS(99.9)',
  elapsed: 123,
  message: '',
  timestamp: 1,
  time: '12:00:00',
}

const validErrorRecord: HistoryRecord = {
  type: 'error',
  answers: '',
  elapsed: 456,
  message: '识别失败',
}

describe('HistoryStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('filters invalid localStorage records without throwing', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({
      main: [
        null,
        'bad',
        { type: 'success', answers: 'TS', elapsed: 'fast', message: '' },
        { type: 'noop', answers: 'TS', elapsed: 1, message: '' },
        validSuccessRecord,
      ],
    }))

    const records = new HistoryStore().get('main')

    expect(records).toEqual([validSuccessRecord])
  })

  it('returns an empty list for corrupted JSON', () => {
    localStorage.setItem(HISTORY_KEY, '{bad json')

    const records = new HistoryStore().get('main')

    expect(records).toEqual([])
  })

  it('drops invalid existing records when adding a new record', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({
      main: [
        null,
        { type: 'random', answers: 42, elapsed: 1, message: 'bad' },
        validErrorRecord,
      ],
    }))
    const newRecord: HistoryRecord = {
      type: 'success',
      answers: 'RA(88.8)',
      elapsed: 99,
      message: '',
    }

    new HistoryStore().add('main', newRecord)

    const raw = localStorage.getItem(HISTORY_KEY)
    expect(raw).not.toBeNull()
    const saved = JSON.parse(raw ?? '{}') as { main?: unknown[] }
    expect(saved.main).toHaveLength(2)
    expect(saved.main?.[0]).toMatchObject(newRecord)
    expect(saved.main?.[1]).toEqual(validErrorRecord)
  })
})
