import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HistoryStore } from '../../src/persistence/answer-history-store'
import type { HistoryRecord, World } from '../../src/persistence/answer-history-types'
import type { SettingsStorage } from '../../src/platform/storage'
import { StatusPanel } from '../../src/status-panel/status-panel'

function deferred<T>(): Readonly<{
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}> {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (error: unknown) => void
  return {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    }),
    resolve: resolvePromise,
    reject: rejectPromise,
  }
}

function settingsStorage(compact = false, requireCsp = true): SettingsStorage {
  const getValue = (key: string): string | null => {
    if (compact && key === 'hvPonySolverPanelCompact') return '1'
    if (!requireCsp && key === 'hvPonySolverPanelRequireCsp') return '0'
    return null
  }
  return {
    getSync: getValue,
    get: async (key) => getValue(key),
    set: async () => undefined,
    remove: async () => undefined,
  }
}

function historyStore(persisted: Promise<HistoryRecord[]>, recordsAfterFailure: HistoryRecord[] = []): HistoryStore {
  return {
    get: vi.fn(() => recordsAfterFailure),
    add: vi.fn((_world: World, record: HistoryRecord) => ({
      records: [record, ...recordsAfterFailure],
      persisted,
    })),
  } as unknown as HistoryStore
}

function deferredSettingsStorage(): Readonly<{
  storage: SettingsStorage
  resolveGet(key: string, value: string): void
}> {
  const resolvers = new Map<string, Array<(value: string) => void>>()
  return {
    storage: {
      getSync: () => null,
      get: (key: string) =>
        new Promise<string>((resolve) => {
          const waiting = resolvers.get(key) ?? []
          waiting.push(resolve)
          resolvers.set(key, waiting)
        }),
      set: async () => undefined,
      remove: async () => undefined,
    },
    resolveGet(key, value) {
      resolvers.get(key)?.shift()?.(value)
    },
  }
}

describe('StatusPanel history persistence', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    history.pushState(null, '', '/')
  })

  it('renders optimistically, then rolls back and exposes a save failure in compact mode', async () => {
    const persistence = deferred<HistoryRecord[]>()
    const store = historyStore(persistence.promise)
    const panel = new StatusPanel(store, settingsStorage(true))

    panel.create()
    panel.addSuccess(['TS'], { TS: 0.99 }, 12)
    await vi.waitFor(() => expect(document.body.textContent).toContain('TS(99.0)'))

    persistence.reject(new Error('quota exceeded'))

    await vi.waitFor(() => expect(document.body.textContent).not.toContain('TS(99.0)'))
    expect(document.body.textContent).toContain('历史记录保存失败：Error: quota exceeded')
    expect(document.body.textContent).not.toContain('模型状态：')
    expect(store.get).toHaveBeenCalledTimes(2)
  })

  it('ignores a late persistence failure after the panel is destroyed', async () => {
    const persistence = deferred<HistoryRecord[]>()
    const panel = new StatusPanel(historyStore(persistence.promise), settingsStorage())

    panel.create()
    panel.addSuccess(['TS'], {}, 12)
    panel.destroy()
    persistence.reject(new Error('late failure'))
    await Promise.resolve()
    await Promise.resolve()

    expect(document.querySelector('.ponyLog')).toBeNull()
    expect(document.body.textContent).not.toContain('late failure')
  })

  it('reconciles optimistic history with the durable records returned by persistence', async () => {
    const persistence = deferred<HistoryRecord[]>()
    const panel = new StatusPanel(historyStore(persistence.promise), settingsStorage())

    panel.create()
    panel.addSuccess(['TS'], {}, 12)
    await vi.waitFor(() => expect(document.body.textContent).toContain('[TS]'))
    persistence.resolve([{ type: 'success', answers: 'RA', elapsed: 20, timestamp: 2, time: '00:00:02' }])

    await vi.waitFor(() => expect(document.body.textContent).toContain('[RA]'))
    expect(document.body.textContent).not.toContain('[TS]')
    expect(document.body.textContent).not.toContain('历史记录保存失败')
  })

  it('ignores an older persistence completion after a newer history mutation settles', async () => {
    const firstPersistence = deferred<HistoryRecord[]>()
    const secondPersistence = deferred<HistoryRecord[]>()
    let addCount = 0
    const store = {
      get: vi.fn(() => []),
      add: vi.fn((_world: World, record: HistoryRecord) => ({
        records: [record],
        persisted: addCount++ === 0 ? firstPersistence.promise : secondPersistence.promise,
      })),
    } as unknown as HistoryStore
    const panel = new StatusPanel(store, settingsStorage())

    panel.create()
    panel.addSuccess(['TS'], {}, 12)
    panel.addSuccess(['RA'], {}, 20)
    secondPersistence.resolve([{ type: 'success', answers: 'RA', elapsed: 20, timestamp: 2, time: '00:00:02' }])
    await vi.waitFor(() => expect(document.body.textContent).toContain('[RA]'))

    firstPersistence.resolve([{ type: 'success', answers: 'TS', elapsed: 12, timestamp: 1, time: '00:00:01' }])
    await Promise.resolve()
    await Promise.resolve()

    expect(document.body.textContent).toContain('[RA]')
    expect(document.body.textContent).not.toContain('[TS]')
  })

  it('ignores an older persistence failure after a newer history mutation settles', async () => {
    const firstPersistence = deferred<HistoryRecord[]>()
    const secondPersistence = deferred<HistoryRecord[]>()
    let addCount = 0
    const store = {
      get: vi.fn(() => []),
      add: vi.fn((_world: World, record: HistoryRecord) => ({
        records: [record],
        persisted: addCount++ === 0 ? firstPersistence.promise : secondPersistence.promise,
      })),
    } as unknown as HistoryStore
    const panel = new StatusPanel(store, settingsStorage())

    panel.create()
    panel.addSuccess(['TS'], {}, 12)
    panel.addSuccess(['RA'], {}, 20)
    secondPersistence.resolve([{ type: 'success', answers: 'RA', elapsed: 20, timestamp: 2, time: '00:00:02' }])
    await vi.waitFor(() => expect(document.body.textContent).toContain('[RA]'))

    firstPersistence.reject(new Error('stale failure'))
    await Promise.resolve()
    await Promise.resolve()

    expect(document.body.textContent).toContain('[RA]')
    expect(document.body.textContent).not.toContain('历史记录保存失败')
  })

  it('drops stale async settings writes after a fast destroy and re-create', async () => {
    const { storage, resolveGet } = deferredSettingsStorage()
    const panel = new StatusPanel(historyStore(Promise.resolve([])), storage)

    panel.create()
    panel.destroy()
    panel.create()

    // The first generation's position read resolves against the new element;
    // the generation guard must discard it instead of moving the fresh panel.
    resolveGet('hvPonySolverPanelPosition', '999,999')
    resolveGet('hvPonySolverPanelCompact', '1')
    resolveGet('hvPonySolverHistoryLimit', '42')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.querySelector<HTMLElement>('.ponyLog')?.style.top).toBe('155px')

    resolveGet('hvPonySolverPanelPosition', '300,200')
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.ponyLog')?.style.top).toBe('300px'))
    expect(document.querySelector<HTMLElement>('.ponyLog')?.style.left).toBe('200px')
  })

  it('starts a fresh status snapshot after destroy and re-create', async () => {
    const panel = new StatusPanel(historyStore(Promise.resolve([])), settingsStorage(false, false))

    panel.create()
    panel.setStatus({ model: '旧模型状态', session: '旧会话状态', inference: '旧推理状态' })
    await vi.waitFor(() => expect(document.body.textContent).toContain('旧模型状态'))
    panel.destroy()
    panel.create()

    expect(document.body.textContent).not.toContain('旧模型状态')
    expect(document.body.textContent).not.toContain('旧会话状态')
    expect(document.body.textContent).not.toContain('旧推理状态')
    expect(document.body.textContent).toContain('模型状态：未开始')
    expect(document.body.textContent).toContain('会话状态：未开始')
    expect(document.body.textContent).toContain('推理状态：空闲')
  })

  it('shows only while a div#csp exists when the default visibility limit is enabled', async () => {
    const panel = new StatusPanel(historyStore(Promise.resolve([])), settingsStorage())
    panel.create()
    const element = document.querySelector<HTMLDivElement>('.ponyLog')!

    expect(element.hidden).toBe(true)
    const wrongElement = document.createElement('span')
    wrongElement.id = 'csp'
    document.body.appendChild(wrongElement)
    await Promise.resolve()
    expect(element.hidden).toBe(true)
    wrongElement.remove()

    const captchaWindow = document.createElement('div')
    captchaWindow.id = 'csp'
    document.body.appendChild(captchaWindow)
    await vi.waitFor(() => expect(element.hidden).toBe(false))

    captchaWindow.id = 'captcha-closed'
    await vi.waitFor(() => expect(element.hidden).toBe(true))
    panel.destroy()
  })

  it('does not reread an initialized synchronous snapshot asynchronously', () => {
    const storage = { ...settingsStorage(), synchronousSnapshot: true }
    const get = vi.spyOn(storage, 'get')
    const panel = new StatusPanel(historyStore(Promise.resolve([])), storage)
    panel.create()
    expect(get).not.toHaveBeenCalled()
    panel.destroy()
  })

  it('preserves external visibility changes while draining its own render mutations', async () => {
    const panel = new StatusPanel(historyStore(Promise.resolve([])), settingsStorage())
    panel.create()
    const element = document.querySelector<HTMLDivElement>('.ponyLog')!
    const csp = document.createElement('div')
    csp.id = 'csp'
    document.body.appendChild(csp)
    panel.setStatus({ model: 'changed' })
    await vi.waitFor(() => expect(element.hidden).toBe(false))
    // 外部节点被放进面板后，下一次渲染移除它也必须更新可见性。
    element.appendChild(csp)
    panel.setStatus({ model: 'changed again' })
    await vi.waitFor(() => expect(element.hidden).toBe(true))
    panel.destroy()
  })

  it('keeps the panel visible without div#csp when the visibility limit is disabled', () => {
    const panel = new StatusPanel(historyStore(Promise.resolve([])), settingsStorage(false, false))
    panel.create()

    expect(document.querySelector<HTMLDivElement>('.ponyLog')?.hidden).toBe(false)
    panel.destroy()
  })
})
