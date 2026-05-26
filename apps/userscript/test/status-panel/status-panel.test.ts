import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HistoryStore } from '../../src/persistence/answer-history-store'
import type { HistoryRecord, World } from '../../src/persistence/answer-history-types'
import { StatusPanel } from '../../src/status-panel/status-panel'

function createHistoryStore(records: HistoryRecord[] = []): HistoryStore {
  return {
    get: vi.fn(() => records),
    add: vi.fn((_world: World, record: HistoryRecord) => [record, ...records]),
  } as unknown as HistoryStore
}

describe('StatusPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    history.pushState(null, '', '/')
  })

  it('does not reread history for status-only updates', () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()
    panel.setStatus({ model: '确认中' })
    panel.setStatus({ inference: '推理中' })

    expect(store.get).toHaveBeenCalledTimes(1)
  })

  it('uses the records returned by add when appending success history', () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()
    panel.addSuccess(['TS'], { TS: 0.99 }, 12)

    expect(store.add).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('TS(99.0)')
    expect(document.body.textContent).toContain('模型状态：')
    expect(document.body.textContent).toContain('会话状态：')
    expect(document.body.textContent).toContain('推理状态：')
  })
})
