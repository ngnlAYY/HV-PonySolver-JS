import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HistoryRecord, World } from '@hv-pony-solver/browser-core'
import type { HistoryStore } from '../../src/persistence/answer-history-store'
import { StatusPanel } from '../../src/status-panel/status-panel'

function createHistoryStore(records: HistoryRecord[] = []): HistoryStore {
  return {
    get: vi.fn(() => records),
    add: vi.fn((_world: World, record: HistoryRecord) => ({
      records: [record, ...records],
      persisted: Promise.resolve([record, ...records]),
    })),
  } as unknown as HistoryStore
}

function createSuccessRecords(count: number): HistoryRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'success',
    answers: `P${index + 1}`,
    elapsed: index + 1,
    time: `00:00:0${index + 1}`,
  }))
}

describe('StatusPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    history.pushState(null, '', '/')
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('queues status-only updates without rereading history', async () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()
    panel.setStatus({ model: '确认中' })
    panel.setStatus({ inference: '推理中' })

    expect(store.get).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('确认中')
    await vi.waitFor(() => expect(document.body.textContent).toContain('确认中'))
    expect(document.body.textContent).toContain('推理中')
  })

  it('uses the records returned by add when appending success history', async () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()
    panel.addSuccess(['TS'], { TS: 0.99 }, 12)

    expect(store.add).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(document.body.textContent).toContain('TS(99.0)'))
    expect(document.body.textContent).toContain('模型状态：')
    expect(document.body.textContent).toContain('会话状态：')
    expect(document.body.textContent).toContain('推理状态：')
  })

  it('records and shows manual results with confidences in compact mode', async () => {
    localStorage.setItem('hvPonySolverPanelCompact', '1')
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()
    panel.addManualResult(['RA'], { RA: 0.975 }, 18)

    expect(store.add).toHaveBeenCalledWith('main', {
      type: 'manual',
      answers: 'RA(97.5)',
      elapsed: 18,
    })
    await vi.waitFor(() => expect(document.body.textContent).toContain('[RA(97.5)] 待手动提交 18ms'))
    expect(document.body.textContent).not.toContain('模型状态：')
  })

  it('escapes manual answers before rendering them', () => {
    const panel = new StatusPanel(
      createHistoryStore([
        {
          type: 'manual',
          answers: '<img src=x onerror=alert(1)>',
          elapsed: 12,
        },
      ]),
    )

    panel.create()

    expect(document.body.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(document.body.innerHTML).not.toContain('<img src=x onerror=alert(1)>')
    expect(document.body.textContent).toContain('待手动提交')
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
    vi.stubGlobal(
      'GM_getValue',
      vi.fn(async (key: string) => (key === 'hvPonySolverPanelCompact' ? '1' : '')),
    )
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()

    await vi.waitFor(() => expect(document.body.textContent).not.toContain('模型状态：'))
    expect(document.body.textContent).not.toContain('会话状态：')
    expect(document.body.textContent).not.toContain('推理状态：')
  })

  it('updates panel position from async GM storage after creating the panel', async () => {
    vi.stubGlobal(
      'GM_getValue',
      vi.fn(async (key: string) => {
        if (key === 'hvPonySolverPanelPosition') {
          return '12,34'
        }
        return ''
      }),
    )
    const panel = new StatusPanel(createHistoryStore())

    panel.create()
    const element = document.querySelector('.ponyLog') as HTMLDivElement

    expect(element.style.top).toBe('155px')
    expect(element.style.left).toBe('1240px')
    await vi.waitFor(() => expect(element.style.top).toBe('12px'))
    expect(element.style.left).toBe('34px')
  })

  it('updates history limit from async GM storage after creating the panel', async () => {
    vi.stubGlobal(
      'GM_getValue',
      vi.fn(async (key: string) => {
        if (key === 'hvPonySolverHistoryLimit') {
          return '2'
        }
        return ''
      }),
    )
    const panel = new StatusPanel(createHistoryStore(createSuccessRecords(6)))

    panel.create()

    expect(document.body.textContent).toContain('P5')
    expect(document.body.textContent).not.toContain('P6')
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('P3'))
    expect(document.body.textContent).toContain('P1')
    expect(document.body.textContent).toContain('P2')
    expect(document.body.textContent).not.toContain('P5')
  })

  it('shows only five answer records by default', () => {
    const store = createHistoryStore(createSuccessRecords(6))
    const panel = new StatusPanel(store)

    panel.create()

    expect(document.body.textContent).toContain('P1')
    expect(document.body.textContent).toContain('P5')
    expect(document.body.textContent).not.toContain('P6')
  })

  it('uses the configured answer record display limit', () => {
    localStorage.setItem('hvPonySolverHistoryLimit', '3')
    const store = createHistoryStore(createSuccessRecords(5))
    const panel = new StatusPanel(store)

    panel.create()

    expect(document.body.textContent).toContain('P1')
    expect(document.body.textContent).toContain('P3')
    expect(document.body.textContent).not.toContain('P4')
  })

  it('shows that there is no recent error when history has no errors', () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()

    expect(document.body.textContent).toContain('最近错误：无')
  })

  it('shows the latest error message and elapsed time', async () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()
    panel.addError('模型加载失败', 34)

    await vi.waitFor(() => expect(document.body.textContent).toContain('最近错误：模型加载失败'))
    expect(document.body.textContent).toContain('模型加载失败 34ms')
  })

  it('escapes error messages before rendering them', async () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()
    panel.addError('<img src=x onerror=alert(1)>', 12)

    await vi.waitFor(() => expect(document.body.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;'))
    expect(document.body.innerHTML).not.toContain('<img src=x onerror=alert(1)>')
  })

  it('coalesces repeated status changes into one rendered update', async () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()
    const element = document.querySelector('.ponyLog') as HTMLDivElement
    const firstRender = element.innerHTML

    panel.setStatus({ model: '下载中' })
    panel.setStatus({ model: '下载中' })
    panel.setStatus({ session: '初始化中' })

    expect(element.innerHTML).toBe(firstRender)
    await vi.waitFor(() => expect(element.textContent).toContain('下载中'))
    expect(element.textContent).toContain('初始化中')
  })

  it('ignores queued renders after destroy', async () => {
    const store = createHistoryStore()
    const panel = new StatusPanel(store)

    panel.create()
    panel.setStatus({ model: '下载中' })
    panel.destroy()
    await Promise.resolve()

    expect(document.querySelector('.ponyLog')).toBeNull()
    expect(document.body.textContent).not.toContain('下载中')
  })
})
