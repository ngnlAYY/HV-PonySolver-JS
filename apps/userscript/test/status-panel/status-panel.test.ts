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
    localStorage.clear()
  })

  it('uses the default panel position when none is saved', () => {
    const panel = new StatusPanel(createHistoryStore())

    panel.create()
    const element = document.querySelector<HTMLDivElement>('.ponyLog')

    expect(element?.style.top).toBe('150px')
    expect(element?.style.left).toBe('1240px')
  })

  it('applies a saved panel position from localStorage immediately on create', () => {
    localStorage.setItem('hvPonySolverPanelPosition', '200,900')
    const panel = new StatusPanel(createHistoryStore())

    panel.create()
    // 位置应在微任务之前就已正确，不需要 await
    const element = document.querySelector<HTMLDivElement>('.ponyLog')

    expect(element?.style.top).toBe('200px')
    expect(element?.style.left).toBe('900px')
  })

  it('applies a saved panel position from storage', async () => {
    localStorage.setItem('hvPonySolverPanelPosition', '200,900')
    const panel = new StatusPanel(createHistoryStore())

    panel.create()
    await Promise.resolve()
    const element = document.querySelector<HTMLDivElement>('.ponyLog')

    expect(element?.style.top).toBe('200px')
    expect(element?.style.left).toBe('900px')
  })

  it('renders only the current inference status', () => {
    const panel = new StatusPanel(createHistoryStore())

    panel.create()
    panel.setStatus({ model: '已缓存', session: '已就绪 12ms', inference: '推理中' })

    expect(document.body.innerHTML).toContain('当前状态：推理中')
    expect(document.body.innerHTML).not.toContain('模型: 已缓存')
    expect(document.body.innerHTML).not.toContain('Session: 已就绪 12ms')
    expect(document.body.innerHTML).not.toContain('识别: 推理中')
    expect(document.body.innerHTML).not.toContain('模型 已缓存')
    expect(document.body.innerHTML).not.toContain('Session 已就绪 12ms')
    expect(document.body.innerHTML).not.toContain('识别 推理中')
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
  })
})
