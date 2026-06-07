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
    vi.unstubAllGlobals()
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

  it('hides model, session, and inference rows in compact mode', () => {
    localStorage.setItem('hvPonySolverPanelCompact', '1')
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()

    expect(document.body.textContent).not.toContain('模型状态：')
    expect(document.body.textContent).not.toContain('会话状态：')
    expect(document.body.textContent).not.toContain('推理状态：')
    expect(document.body.textContent).toContain('最近错误：无')
    expect(document.body.textContent).toContain('最近答题:')
  })

  it('updates compact mode from async GM storage after creating the panel', async () => {
    vi.stubGlobal('GM_getValue', vi.fn(async (key: string) => key === 'hvPonySolverPanelCompact' ? '1' : ''))
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()

    await vi.waitFor(() => expect(document.body.textContent).not.toContain('模型状态：'))
    expect(document.body.textContent).not.toContain('会话状态：')
    expect(document.body.textContent).not.toContain('推理状态：')
  })

  it('shows that there is no recent error when history has no errors', () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()

    expect(document.body.textContent).toContain('最近错误：无')
  })

  it('shows the latest error message and elapsed time', () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()
    panel.addError('模型加载失败', 34)

    expect(document.body.textContent).toContain('最近错误：模型加载失败')
    expect(document.body.textContent).toContain('模型加载失败 34ms')
  })

  it('escapes error messages before rendering them', () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()
    panel.addError('<img src=x onerror=alert(1)>', 12)

    expect(document.body.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(document.body.innerHTML).not.toContain('<img src=x onerror=alert(1)>')
  })
})
