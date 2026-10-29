import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HistoryStore } from '../../src/persistence/answer-history-store'
import type { HistoryRecord, World } from '../../src/persistence/answer-history-types'
import type { EnumerableTextStorage, SettingsStorage } from '../../src/platform/storage'
import { StatusPanel } from '../../src/status-panel/status-panel'

const panels: StatusPanel[] = []

function createPanel(history: HistoryStore, storage: SettingsStorage): StatusPanel {
  const panel = new StatusPanel(history, storage)
  panels.push(panel)
  return panel
}

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

function createHistoryStorage(optimistic = false) {
  const values = new Map<string, string>()
  let nextWrite: Promise<void> | null = null
  const storage: EnumerableTextStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      const pending = nextWrite
      nextWrite = null
      if (pending) {
        const previous = values.get(key)
        if (optimistic) values.set(key, value)
        return pending.then(
          () => {
            values.set(key, value)
          },
          (error: unknown) => {
            if (optimistic) {
              if (previous === undefined) values.delete(key)
              else values.set(key, previous)
            }
            throw error
          },
        )
      }
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
    getItemsByPrefix: (prefix) => Array.from(values.entries()).filter(([key]) => key.startsWith(prefix)),
  }
  return {
    storage,
    deferNextWrite() {
      const write = deferred<void>()
      nextWrite = write.promise
      return write
    },
  }
}

describe('StatusPanel history persistence', () => {
  afterEach(() => {
    for (const panel of panels.splice(0)) panel.destroy()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    document.body.innerHTML = ''
    history.pushState(null, '', '/')
  })

  it('uses the current world when first created after navigation', async () => {
    const { storage } = createHistoryStorage()
    const store = new HistoryStore(storage)
    const panel = createPanel(store, settingsStorage(false, false))

    history.pushState(null, '', '/isekai/')
    panel.create()
    panel.addSuccess(['TS'], {}, 12)
    await vi.waitFor(() => expect(document.querySelector('.ponyLog')?.textContent).toContain('[TS]'))

    expect(document.querySelector('.ponyLog strong')?.textContent).toBe('异世界')
    expect(store.get('main')).toEqual([])
    expect(store.get('isekai')).toMatchObject([{ type: 'success', answers: 'TS', elapsed: 12 }])
  })

  it('partitions new history by the current URL and preserves both worlds on return', async () => {
    const { storage } = createHistoryStorage()
    const store = new HistoryStore(storage)
    const panel = createPanel(store, settingsStorage(false, false))
    panel.create()
    const element = document.querySelector<HTMLDivElement>('.ponyLog')!
    panel.addSuccess(['TS'], {}, 12)
    await vi.waitFor(() => expect(element.textContent).toContain('[TS]'))

    history.pushState(null, '', '/isekai/')
    panel.addManualResult(['RA'], { RA: 0.95 }, 20)
    await vi.waitFor(() => expect(element.querySelector('strong')?.textContent).toBe('异世界'))
    expect(element.textContent).toContain('[RA(95.0)]')
    expect(element.textContent).not.toContain('[TS]')
    expect(store.get('main')).toMatchObject([{ type: 'success', answers: 'TS' }])
    expect(store.get('isekai')).toMatchObject([{ type: 'manual', answers: 'RA(95.0)' }])

    history.pushState(null, '', '/')
    panel.addRandomFailure('RD', 30)
    await vi.waitFor(() => expect(element.querySelector('strong')?.textContent).toBe('主世界'))
    expect(element.textContent).toContain('识别失败，随机选择 RD')
    expect(element.textContent).toContain('[TS]')
    expect(element.textContent).not.toContain('[RA(95.0)]')
    expect(store.get('main')).toMatchObject([
      { type: 'random', answers: 'RD' },
      { type: 'success', answers: 'TS' },
    ])
    expect(store.get('isekai')).toMatchObject([{ type: 'manual', answers: 'RA(95.0)' }])
    expect(document.querySelector('.ponyLog')).toBe(element)
    expect(document.querySelectorAll('.ponyLog')).toHaveLength(1)
  })

  it.each(['create', 'status', 'body replacement'] as const)(
    'refreshes stored history in both directions on %s without recreating the panel',
    async (activity) => {
      const { storage } = createHistoryStorage()
      const store = new HistoryStore(storage)
      await store.add('main', { type: 'error', message: '主世界保存的错误', elapsed: 1 }).persisted
      await store.add('isekai', { type: 'success', answers: 'RA', elapsed: 2 }).persisted
      const panel = createPanel(store, settingsStorage(false, false))
      panel.create()
      panel.setStatus({ model: '模型已加载' })
      const element = document.querySelector<HTMLDivElement>('.ponyLog')!
      await vi.waitFor(() => expect(element.textContent).toContain('模型已加载'))
      const refresh = () => {
        if (activity === 'create') panel.create()
        else if (activity === 'status') panel.setSessionReady(8)
        else document.body.replaceChildren(document.createElement('main'))
      }

      history.pushState(null, '', '/isekai/')
      refresh()
      await vi.waitFor(() => expect(element.querySelector('strong')?.textContent).toBe('异世界'))
      expect(element.textContent).toContain('异世界最近答题:')
      expect(element.textContent).toContain('[RA]')
      expect(element.textContent).toContain('最近错误：无')
      expect(element.textContent).not.toContain('主世界保存的错误')
      expect(element.textContent).toContain('模型已加载')
      expect(document.querySelector('.ponyLog')).toBe(element)

      history.pushState(null, '', '/')
      refresh()
      await vi.waitFor(() => expect(element.querySelector('strong')?.textContent).toBe('主世界'))
      expect(element.textContent).toContain('主世界最近答题:')
      expect(element.textContent).toContain('最近错误：主世界保存的错误')
      expect(element.textContent).not.toContain('[RA]')
      expect(element.textContent).toContain('模型已加载')
      expect(element.hidden).toBe(false)
      expect(element.style.top).toBe('155px')
      expect(element.style.left).toBe('1240px')
      expect(document.querySelector('.ponyLog')).toBe(element)
      expect(document.querySelectorAll('.ponyLog')).toHaveLength(1)
    },
  )

  it.each(['success', 'failure'] as const)(
    'observes navigation when an old-world persistence %s is the next panel activity',
    async (outcome) => {
      const { storage, deferNextWrite } = createHistoryStorage()
      const store = new HistoryStore(storage)
      await store.add('main', { type: 'success', answers: 'TS', elapsed: 1 }).persisted
      await store.add('isekai', { type: 'success', answers: 'RA', elapsed: 2 }).persisted
      const panel = createPanel(store, settingsStorage(false, false))
      panel.create()
      const element = document.querySelector<HTMLDivElement>('.ponyLog')!
      const oldWrite = deferNextWrite()
      const add = vi.spyOn(store, 'add')
      panel.addSuccess(['RD'], {}, 12)
      const result = add.mock.results[0]
      if (result?.type !== 'return') throw new Error('History mutation did not start')
      await vi.waitFor(() => expect(element.textContent).toContain('[RD]'))

      history.pushState(null, '', '/isekai/')
      if (outcome === 'success') oldWrite.resolve()
      else oldWrite.reject(new Error('old-world write failed'))
      await result.value.persisted.catch(() => undefined)

      expect(element.querySelector('strong')?.textContent).toBe('异世界')
      expect(element.textContent).toContain('[RA]')
      expect(element.textContent).not.toContain('[TS]')
      expect(element.textContent).not.toContain('[RD]')
      expect(element.textContent).not.toContain('历史记录保存失败')
      expect(store.get('isekai')).toMatchObject([{ answers: 'RA' }])
      expect(store.get('main').map((record) => record.type === 'success' && record.answers)).toEqual(
        outcome === 'success' ? ['RD', 'TS'] : ['TS'],
      )

      history.pushState(null, '', '/')
      panel.create()
      expect(element.querySelector('strong')?.textContent).toBe('主世界')
      expect(element.textContent).toContain('[TS]')
      if (outcome === 'success') expect(element.textContent).toContain('[RD]')
      else expect(element.textContent).not.toContain('[RD]')
      expect(element.textContent).not.toContain('[RA]')
      expect(element.textContent).not.toContain('历史记录保存失败')
      expect(document.querySelector('.ponyLog')).toBe(element)
    },
  )

  it.each([
    ['success', false],
    ['failure', false],
    ['success', true],
    ['failure', true],
  ] as const)(
    'keeps current records and persistence errors after a prior visit settles with %s (return=%s)',
    async (outcome, returnToMain) => {
      const { storage, deferNextWrite } = createHistoryStorage()
      const store = new HistoryStore(storage)
      await store.add('main', { type: 'success', answers: 'TS', elapsed: 1 }).persisted
      await store.add('isekai', { type: 'success', answers: 'RA', elapsed: 2 }).persisted
      const panel = createPanel(store, settingsStorage(false, false))
      panel.create()
      const element = document.querySelector<HTMLDivElement>('.ponyLog')!
      const oldWrite = deferNextWrite()
      const add = vi.spyOn(store, 'add')
      panel.addSuccess(['RD'], {}, 12)
      const result = add.mock.results[0]
      if (result?.type !== 'return') throw new Error('History mutation did not start')
      await vi.waitFor(() => expect(element.textContent).toContain('[RD]'))

      history.pushState(null, '', '/isekai/')
      panel.create()
      if (returnToMain) {
        history.pushState(null, '', '/')
        panel.setStatus({ inference: '返回主世界' })
      }
      const currentWrite = deferNextWrite()
      panel.addSuccess(['PP'], {}, 20)
      currentWrite.reject(new Error('current-world write failed'))
      await vi.waitFor(() =>
        expect(element.textContent).toContain('历史记录保存失败：Error: current-world write failed'),
      )
      const content = element.textContent

      if (outcome === 'success') oldWrite.resolve()
      else oldWrite.reject(new Error('old-world write failed'))
      await result.value.persisted.catch(() => undefined)

      expect(element.textContent).toBe(content)
      expect(element.querySelector('strong')?.textContent).toBe(returnToMain ? '主世界' : '异世界')
      expect(element.textContent).not.toContain('old-world write failed')
      expect(element.textContent).not.toContain('[PP]')
      expect(element.textContent).not.toContain('[RD]')
      expect(store.get('isekai')).toMatchObject([{ answers: 'RA' }])
      expect(store.get('main').map((record) => record.type === 'success' && record.answers)).toEqual(
        outcome === 'success' ? ['RD', 'TS'] : ['TS'],
      )

      history.pushState(null, '', returnToMain ? '/isekai/' : '/')
      panel.create()
      expect(element.textContent).not.toContain('历史记录保存失败')
      expect(document.querySelector('.ponyLog')).toBe(element)
    },
  )

  it('reconciles a failed optimistic write after a round trip without restoring its prior-visit error', async () => {
    const { storage, deferNextWrite } = createHistoryStorage(true)
    const store = new HistoryStore(storage)
    await store.add('main', { type: 'success', answers: 'TS', elapsed: 1 }).persisted
    await store.add('isekai', { type: 'success', answers: 'RA', elapsed: 2 }).persisted
    const panel = createPanel(store, settingsStorage(false, false))
    panel.create()
    const element = document.querySelector<HTMLDivElement>('.ponyLog')!
    const oldWrite = deferNextWrite()
    const add = vi.spyOn(store, 'add')
    panel.addSuccess(['RD'], {}, 12)
    const result = add.mock.results[0]
    if (result?.type !== 'return') throw new Error('History mutation did not start')
    await vi.waitFor(() => expect(element.textContent).toContain('[RD]'))

    history.pushState(null, '', '/isekai/')
    panel.create()
    expect(element.textContent).toContain('[RA]')
    expect(element.textContent).not.toContain('[RD]')
    history.pushState(null, '', '/')
    panel.create()
    expect(element.textContent).toContain('[RD]')

    oldWrite.reject(new Error('prior-visit write failed'))
    await result.value.persisted.catch(() => undefined)

    expect(element.querySelector('strong')?.textContent).toBe('主世界')
    expect(element.textContent).toContain('[TS]')
    expect(element.textContent).not.toContain('[RD]')
    expect(element.textContent).not.toContain('历史记录保存失败')
    expect(store.get('main')).toMatchObject([{ answers: 'TS' }])
    expect(store.get('isekai')).toMatchObject([{ answers: 'RA' }])
    expect(document.querySelector('.ponyLog')).toBe(element)
  })

  it.each([true, false])('starts without a body and mounts when one arrives (requireCsp=%s)', async (requireCsp) => {
    const body = document.body
    const panel = createPanel(historyStore(Promise.resolve([])), settingsStorage(false, requireCsp))
    body.remove()
    try {
      expect(() => panel.create()).not.toThrow()
      panel.setStatus({ inference: '等待页面恢复' })
      await Promise.resolve()
      expect(document.querySelector('.ponyLog')).toBeNull()
    } finally {
      document.documentElement.appendChild(body)
    }
    await vi.waitFor(() => expect(document.querySelector('.ponyLog')?.textContent).toContain('等待页面恢复'))
    expect(document.querySelector<HTMLElement>('.ponyLog')?.hidden).toBe(requireCsp)
    panel.destroy()
    body.remove()
    document.documentElement.appendChild(body)
    await Promise.resolve()
    expect(document.querySelector('.ponyLog')).toBeNull()
  })

  it('does not mount if destroyed before the first body arrives', async () => {
    const body = document.body
    const panel = createPanel(historyStore(Promise.resolve([])), settingsStorage())
    body.remove()
    try {
      panel.create()
      panel.destroy()
    } finally {
      document.documentElement.appendChild(body)
    }
    await Promise.resolve()
    expect(document.querySelector('.ponyLog')).toBeNull()
  })

  it('renders optimistically, then rolls back and exposes a save failure in compact mode', async () => {
    const persistence = deferred<HistoryRecord[]>()
    const store = historyStore(persistence.promise)
    const panel = createPanel(store, settingsStorage(true))

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
    const panel = createPanel(historyStore(persistence.promise), settingsStorage())

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
    const panel = createPanel(historyStore(persistence.promise), settingsStorage())

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
    const panel = createPanel(store, settingsStorage())

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

  it('reconciles an older persistence failure after a newer history mutation settles', async () => {
    const firstPersistence = deferred<HistoryRecord[]>()
    const secondPersistence = deferred<HistoryRecord[]>()
    const durableRecords: HistoryRecord[] = [
      { type: 'success', answers: 'RA', elapsed: 20, timestamp: 2, time: '00:00:02' },
    ]
    let addCount = 0
    const store = {
      get: vi.fn().mockReturnValueOnce([]).mockReturnValue(durableRecords),
      add: vi.fn((_world: World, record: HistoryRecord) => ({
        records: [record],
        persisted: addCount++ === 0 ? firstPersistence.promise : secondPersistence.promise,
      })),
    } as unknown as HistoryStore
    const panel = createPanel(store, settingsStorage())

    panel.create()
    panel.addSuccess(['TS'], {}, 12)
    panel.addSuccess(['RA'], {}, 20)
    secondPersistence.resolve(durableRecords)
    await vi.waitFor(() => expect(document.body.textContent).toContain('[RA]'))

    firstPersistence.reject(new Error('stale failure'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('历史记录保存失败：Error: stale failure'))

    expect(document.body.textContent).toContain('[RA]')
    expect(document.body.textContent).not.toContain('[TS]')
    expect(store.get).toHaveBeenCalledTimes(2)
  })

  it('drops stale async settings writes after a fast destroy and re-create', async () => {
    const { storage, resolveGet } = deferredSettingsStorage()
    const panel = createPanel(historyStore(Promise.resolve([])), storage)

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
    const panel = createPanel(historyStore(Promise.resolve([])), settingsStorage(false, false))

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
    const panel = createPanel(historyStore(Promise.resolve([])), settingsStorage())
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
    const panel = createPanel(historyStore(Promise.resolve([])), storage)
    panel.create()
    expect(get).not.toHaveBeenCalled()
    panel.destroy()
  })

  it('keeps visibility tied to any div#csp when earlier duplicate IDs belong to other elements', async () => {
    const wrongElement = document.createElement('span')
    wrongElement.id = 'csp'
    const firstWindow = document.createElement('div')
    firstWindow.id = 'csp'
    const container = document.createElement('section')
    const secondWindow = document.createElement('div')
    secondWindow.id = 'csp'
    container.append(secondWindow)
    document.body.append(wrongElement, firstWindow, container)
    const panel = createPanel(historyStore(Promise.resolve([])), settingsStorage())
    panel.create()
    const element = document.querySelector<HTMLDivElement>('.ponyLog')!
    expect(element.hidden).toBe(false)

    firstWindow.remove()
    await Promise.resolve()
    expect(element.hidden).toBe(false)
    container.remove()
    await Promise.resolve()
    expect(element.hidden).toBe(true)
    wrongElement.replaceWith(container)
    await Promise.resolve()
    expect(element.hidden).toBe(false)
    secondWindow.removeAttribute('id')
    await Promise.resolve()
    expect(element.hidden).toBe(true)
  })

  it('preserves external visibility changes while draining its own render mutations', async () => {
    const panel = createPanel(historyStore(Promise.resolve([])), settingsStorage())
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

  it.each([true, false])(
    'reattaches the same history and status panel after body contents change (requireCsp=%s)',
    async (requireCsp) => {
      const persistence = deferred<HistoryRecord[]>()
      const store = historyStore(persistence.promise)
      const panel = createPanel(store, settingsStorage(false, requireCsp))
      panel.create()
      panel.setStatus({ model: '模型已加载', inference: '识别完成' })
      panel.addSuccess(['TS'], { TS: 0.99 }, 12)
      await vi.waitFor(() => expect(document.body.textContent).toContain('TS(99.0)'))
      const element = document.querySelector<HTMLDivElement>('.ponyLog')!
      const content = element.textContent
      const riddle = document.createElement('div')
      riddle.id = 'csp'

      document.body.replaceChildren(riddle)

      await vi.waitFor(() => expect(document.querySelector('.ponyLog')).toBe(element))
      expect(element.textContent).toBe(content)
      expect(element.hidden).toBe(false)
      expect(document.querySelectorAll('.ponyLog')).toHaveLength(1)
      expect(store.get).toHaveBeenCalledTimes(1)
      expect(store.add).toHaveBeenCalledTimes(1)
    },
  )

  it('reattaches hidden without csp and becomes visible when csp arrives later', async () => {
    const panel = createPanel(historyStore(Promise.resolve([])), settingsStorage())
    panel.create()
    const element = document.querySelector<HTMLDivElement>('.ponyLog')!

    document.body.replaceChildren(document.createElement('main'))

    await vi.waitFor(() => expect(document.querySelector('.ponyLog')).toBe(element))
    expect(element.hidden).toBe(true)
    const riddle = document.createElement('div')
    riddle.id = 'csp'
    document.body.appendChild(riddle)
    await vi.waitFor(() => expect(element.hidden).toBe(false))
  })

  it('moves the original panel into a replacement body', async () => {
    const panel = createPanel(historyStore(Promise.resolve([])), settingsStorage(false, false))
    panel.create()
    const element = document.querySelector<HTMLDivElement>('.ponyLog')!
    const body = document.createElement('body')
    expect(element.hidden).toBe(false)

    document.body.replaceWith(body)

    await vi.waitFor(() => expect(element.parentElement).toBe(body))
    expect(element.hidden).toBe(false)
  })

  it('reattaches when a previously queued render drains the external removal record', async () => {
    const panel = createPanel(historyStore(Promise.resolve([])), settingsStorage())
    panel.create()
    const element = document.querySelector<HTMLDivElement>('.ponyLog')!
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Queue render before removal so render runs before the mutation observer.
    panel.setStatus({ inference: '新的识别状态' })
    const riddle = document.createElement('div')
    riddle.id = 'csp'
    document.body.replaceChildren(riddle)

    await vi.waitFor(() => expect(document.querySelector('.ponyLog')).toBe(element))
    expect(element.textContent).toContain('新的识别状态')
    expect(element.hidden).toBe(false)
  })

  it('does not resurrect a destroyed panel from queued render, removal or persistence callbacks', async () => {
    const persistence = deferred<HistoryRecord[]>()
    const panel = createPanel(historyStore(persistence.promise), settingsStorage(false, false))
    panel.create()
    const element = document.querySelector<HTMLDivElement>('.ponyLog')!
    panel.addSuccess(['TS'], {}, 12)
    document.body.replaceChildren(document.createElement('main'))
    panel.destroy()
    persistence.resolve([{ type: 'success', answers: 'TS', elapsed: 12 }])
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(element.isConnected).toBe(false)
    expect(document.querySelector('.ponyLog')).toBeNull()
  })
})
