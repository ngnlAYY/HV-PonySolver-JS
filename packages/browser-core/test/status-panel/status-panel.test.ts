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

function settingsStorage(compact = false): SettingsStorage {
  const getValue = (key: string): string | null => (compact && key === 'hvPonySolverPanelCompact' ? '1' : null)
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
    expect(document.querySelector<HTMLElement>('.ponyLog')?.style.top).toBe('150px')

    resolveGet('hvPonySolverPanelPosition', '300,200')
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.ponyLog')?.style.top).toBe('300px'))
    expect(document.querySelector<HTMLElement>('.ponyLog')?.style.left).toBe('200px')
  })
})
