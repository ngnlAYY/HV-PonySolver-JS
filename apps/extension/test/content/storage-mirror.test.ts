import { HistoryStore } from '@hv-pony-solver/browser-core/persistence/answer-history-store'
import { HISTORY_ENTRY_PREFIX, HISTORY_KEY } from '@hv-pony-solver/browser-core/persistence/answer-history-config'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ExtensionStorageMirror } from '../../src/content/storage-mirror'
import type { RawExtensionApi, StorageChanges } from '../../src/platform/webextension-api'
import { rawExtensionApi } from '../platform/webextension-api-fixture'

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

function emitStorageChanges(api: RawExtensionApi, changes: StorageChanges): void {
  const event = api.storage.onChanged as typeof api.storage.onChanged & {
    emit(changes: StorageChanges, areaName: string): void
  }
  event.emit(changes, 'local')
}

function mutationStateCount(mirror: ExtensionStorageMirror): number {
  return (mirror as unknown as { mutationStates: Map<string, unknown> }).mutationStates.size
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ExtensionStorageMirror', () => {
  it('subscribes before reading the snapshot and replays changes from that window', async () => {
    const api = rawExtensionApi()
    const snapshot = deferred<Record<string, unknown>>()
    vi.mocked(api.storage.local.get).mockReturnValue(snapshot.promise)
    vi.stubGlobal('browser', api)

    const creation = ExtensionStorageMirror.create()
    expect(api.storage.onChanged.addListener).toHaveBeenCalledTimes(1)
    emitStorageChanges(api, {
      changedDuringSnapshot: { oldValue: 'stale', newValue: 'fresh' },
      removedDuringSnapshot: { oldValue: 'present' },
    })
    snapshot.resolve({ changedDuringSnapshot: 'stale', removedDuringSnapshot: 'present', stable: 'value' })

    const mirror = await creation
    expect(mirror.getSync('changedDuringSnapshot')).toBe('fresh')
    expect(mirror.getSync('removedDuringSnapshot')).toBeNull()
    expect(mirror.getSync('stable')).toBe('value')

    mirror.destroy()
    expect(api.storage.onChanged.removeListener).toHaveBeenCalledTimes(1)
  })

  it('does not retain mutation state for snapshot values or committed-only storage changes', async () => {
    const api = rawExtensionApi()
    vi.mocked(api.storage.local.get).mockResolvedValue({ initial: 'value' })
    vi.stubGlobal('browser', api)

    const mirror = await ExtensionStorageMirror.create()
    expect(mutationStateCount(mirror)).toBe(0)

    emitStorageChanges(api, {
      initial: { oldValue: 'value', newValue: 'updated' },
      added: { newValue: 'fresh' },
      removed: { oldValue: 'gone' },
    })

    expect(mirror.getSync('initial')).toBe('updated')
    expect(mirror.getSync('added')).toBe('fresh')
    expect(mirror.getSync('removed')).toBeNull()
    expect(mutationStateCount(mirror)).toBe(0)
  })

  it('notifies committed-change listeners for external changes only', async () => {
    const api = rawExtensionApi()
    vi.mocked(api.storage.local.get).mockResolvedValue({ setting: 'initial' })
    const persistence = deferred<void>()
    vi.mocked(api.storage.local.set).mockReturnValue(persistence.promise)
    vi.stubGlobal('browser', api)
    const mirror = await ExtensionStorageMirror.create()

    const events: Array<[string, string | null, string | null]> = []
    const unsubscribe = mirror.addCommittedChangeListener((key, newValue, oldValue) => {
      events.push([key, newValue, oldValue])
    })

    emitStorageChanges(api, { setting: { oldValue: 'initial', newValue: 'updated' } })
    expect(events).toEqual([['setting', 'updated', 'initial']])

    const write = mirror.set('setting', 'local')
    persistence.resolve(undefined)
    await expect(write).resolves.toBeUndefined()
    expect(events).toEqual([['setting', 'updated', 'initial']])

    unsubscribe()
    emitStorageChanges(api, { setting: { oldValue: 'local', newValue: 'external' } })
    expect(mirror.getSync('setting')).toBe('external')
    expect(events).toEqual([['setting', 'updated', 'initial']])

    mirror.destroy()
    emitStorageChanges(api, { setting: { oldValue: 'external', newValue: 'ignored' } })
    expect(events).toEqual([['setting', 'updated', 'initial']])
  })

  it.each(['success', 'failure'] as const)('prunes mutation state after the final local mutation %s', async (outcome) => {
    const api = rawExtensionApi()
    const persistence = deferred<void>()
    vi.mocked(api.storage.local.get).mockResolvedValue({ setting: 'old' })
    vi.mocked(api.storage.local.set).mockReturnValue(persistence.promise)
    vi.stubGlobal('browser', api)
    const mirror = await ExtensionStorageMirror.create()

    const write = mirror.set('setting', 'new')
    expect(mutationStateCount(mirror)).toBe(1)
    if (outcome === 'success') {
      persistence.resolve(undefined)
      await expect(write).resolves.toBeUndefined()
      expect(mirror.getSync('setting')).toBe('new')
    } else {
      persistence.reject(new Error('write failed'))
      await expect(write).rejects.toThrow('write failed')
      expect(mirror.getSync('setting')).toBe('old')
    }
    expect(mutationStateCount(mirror)).toBe(0)
  })

  it('keeps state and revision protection until the final queued mutation settles', async () => {
    const api = rawExtensionApi()
    const firstPersistence = deferred<void>()
    const secondPersistence = deferred<void>()
    vi.mocked(api.storage.local.get).mockResolvedValue({ setting: 'base' })
    vi.mocked(api.storage.local.set)
      .mockReturnValueOnce(firstPersistence.promise)
      .mockReturnValueOnce(secondPersistence.promise)
    vi.stubGlobal('browser', api)
    const mirror = await ExtensionStorageMirror.create()

    const firstWrite = mirror.set('setting', 'first')
    const secondWrite = mirror.set('setting', 'second')
    emitStorageChanges(api, { setting: { oldValue: 'base', newValue: 'remote' } })
    firstPersistence.resolve(undefined)
    await expect(firstWrite).resolves.toBeUndefined()

    expect(mirror.getSync('setting')).toBe('second')
    expect(mutationStateCount(mirror)).toBe(1)
    await vi.waitFor(() => expect(api.storage.local.set).toHaveBeenCalledTimes(2))
    secondPersistence.reject(new Error('second failed'))
    await expect(secondWrite).rejects.toThrow('second failed')

    expect(mirror.getSync('setting')).toBe('first')
    expect(mutationStateCount(mirror)).toBe(0)
  })

  it('rolls back optimistic set and remove mutations when storage rejects', async () => {
    const api = rawExtensionApi()
    const failedSet = deferred<void>()
    const failedRemove = deferred<void>()
    vi.mocked(api.storage.local.get).mockResolvedValue({ setting: 'old', removable: 'kept' })
    vi.mocked(api.storage.local.set).mockReturnValueOnce(failedSet.promise)
    vi.mocked(api.storage.local.remove).mockReturnValueOnce(failedRemove.promise)
    vi.stubGlobal('browser', api)
    const mirror = await ExtensionStorageMirror.create()

    const setPromise = mirror.setItem('setting', 'new')
    expect(mirror.getSync('setting')).toBe('new')
    failedSet.reject(new Error('set failed'))
    await expect(setPromise).rejects.toThrow('set failed')
    expect(mirror.getSync('setting')).toBe('old')

    const removePromise = mirror.removeItem('removable')
    expect(mirror.getSync('removable')).toBeNull()
    failedRemove.reject(new Error('remove failed'))
    await expect(removePromise).rejects.toThrow('remove failed')
    expect(mirror.getSync('removable')).toBe('kept')
  })

  it('recomputes visible state when overlapping optimistic mutations both fail', async () => {
    const api = rawExtensionApi()
    const firstFailure = deferred<void>()
    const secondFailure = deferred<void>()
    vi.mocked(api.storage.local.get).mockResolvedValue({ setting: 'base' })
    vi.mocked(api.storage.local.set)
      .mockReturnValueOnce(firstFailure.promise)
      .mockReturnValueOnce(secondFailure.promise)
    vi.stubGlobal('browser', api)
    const mirror = await ExtensionStorageMirror.create()

    const firstWrite = mirror.set('setting', 'first')
    const secondWrite = mirror.set('setting', 'second')
    expect(mirror.getSync('setting')).toBe('second')

    firstFailure.reject(new Error('first failed'))
    await expect(firstWrite).rejects.toThrow('first failed')
    expect(mirror.getSync('setting')).toBe('second')

    await vi.waitFor(() => expect(api.storage.local.set).toHaveBeenCalledTimes(2))
    secondFailure.reject(new Error('second failed'))
    await expect(secondWrite).rejects.toThrow('second failed')
    expect(mirror.getSync('setting')).toBe('base')
  })

  it('ignores storage events and late write completion after destroy', async () => {
    const api = rawExtensionApi()
    const pendingWrite = deferred<void>()
    vi.mocked(api.storage.local.get).mockResolvedValue({ setting: 'old' })
    vi.mocked(api.storage.local.set).mockReturnValue(pendingWrite.promise)
    vi.stubGlobal('browser', api)
    const mirror = await ExtensionStorageMirror.create()

    const write = mirror.set('setting', 'new')
    await vi.waitFor(() => expect(api.storage.local.set).toHaveBeenCalledTimes(1))
    mirror.destroy()
    expect(mirror.getSync('setting')).toBeNull()

    pendingWrite.resolve(undefined)
    await expect(write).resolves.toBeUndefined()
    emitStorageChanges(api, { setting: { oldValue: 'new', newValue: 'late' } })
    expect(mirror.getSync('setting')).toBeNull()
  })

  it('preserves interleaved history writes from two extension contexts', async () => {
    const api = rawExtensionApi()
    const persisted = new Map<string, unknown>()
    const writes: Array<{
      readonly items: Record<string, unknown>
      resolve(): void
    }> = []
    vi.mocked(api.storage.local.get).mockImplementation(async () => Object.fromEntries(persisted))
    vi.mocked(api.storage.local.set).mockImplementation(
      (items) =>
        new Promise<void>((resolve) => {
          writes.push({ items, resolve })
        }),
    )
    vi.mocked(api.storage.local.remove).mockImplementation(async (keys) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        const oldValue = persisted.get(key)
        persisted.delete(key)
        emitStorageChanges(api, { [key]: { oldValue } })
      }
    })
    vi.stubGlobal('browser', api)

    const firstMirror = await ExtensionStorageMirror.create()
    const secondMirror = await ExtensionStorageMirror.create()
    const firstStore = new HistoryStore(firstMirror, () => 'context-a')
    const secondStore = new HistoryStore(secondMirror, () => 'context-b')
    const firstMutation = firstStore.add('main', { type: 'success', answers: 'TS', elapsed: 10 })
    const secondMutation = secondStore.add('main', { type: 'success', answers: 'RA', elapsed: 20 })

    await vi.waitFor(() => expect(writes).toHaveLength(2))
    for (const write of [writes[1]!, writes[0]!]) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
      for (const [key, value] of Object.entries(write.items)) {
        changes[key] = { oldValue: persisted.get(key), newValue: value }
        persisted.set(key, value)
      }
      emitStorageChanges(api, changes)
      write.resolve()
    }
    await Promise.all([firstMutation.persisted, secondMutation.persisted])

    const historyKeys = Array.from(persisted.keys()).filter((key) => key.startsWith(HISTORY_ENTRY_PREFIX))
    expect(historyKeys).toHaveLength(2)
    expect(persisted.has(HISTORY_KEY)).toBe(false)

    const freshMirror = await ExtensionStorageMirror.create()
    const records = new HistoryStore(freshMirror).get('main')
    expect(records.map((record) => (record.type === 'error' ? record.message : record.answers)).sort()).toEqual([
      'RA',
      'TS',
    ])

    firstMirror.destroy()
    secondMirror.destroy()
    freshMirror.destroy()
  })
})
