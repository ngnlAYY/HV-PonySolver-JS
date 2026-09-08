import { HistoryStore } from '@hv-pony-solver/browser-core/persistence/answer-history-store'
import { HISTORY_ENTRY_PREFIX } from '@hv-pony-solver/browser-core/persistence/answer-history-config'
import { StatusPanel } from '@hv-pony-solver/browser-core/status-panel/status-panel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExtensionStorageMirror } from '../../src/content/storage-mirror'
import type { RawExtensionApi, StorageChanges } from '../../src/platform/webextension-api'
import { rawExtensionApi } from '../platform/webextension-api-fixture'

type PendingWrite = Readonly<{
  readonly items: Record<string, unknown>
  resolve(): void
  reject(error: unknown): void
}>

function emitStorageChanges(api: RawExtensionApi, changes: StorageChanges): void {
  const event = api.storage.onChanged as typeof api.storage.onChanged & {
    emit(changes: StorageChanges, areaName: string): void
  }
  event.emit(changes, 'local')
}

function commitWrite(api: RawExtensionApi, persisted: Map<string, unknown>, write: PendingWrite): void {
  const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
  for (const [key, value] of Object.entries(write.items)) {
    changes[key] = { oldValue: persisted.get(key), newValue: value }
    persisted.set(key, value)
  }
  emitStorageChanges(api, changes)
  write.resolve()
}

describe('StatusPanel with ExtensionStorageMirror', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    history.pushState(null, '', '/')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reconciles a late failed key after a newer key persists', async () => {
    const api = rawExtensionApi()
    const persisted = new Map<string, unknown>()
    const writes: PendingWrite[] = []
    vi.mocked(api.storage.local.get).mockImplementation(async () => Object.fromEntries(persisted))
    vi.mocked(api.storage.local.set).mockImplementation(
      (items) =>
        new Promise<void>((resolve, reject) => {
          writes.push({ items, resolve, reject })
        }),
    )
    vi.stubGlobal('browser', api)

    const mirror = await ExtensionStorageMirror.create()
    const entryIds = ['A', 'B']
    const historyStore = new HistoryStore(mirror, () => entryIds.shift()!)
    const panel = new StatusPanel(historyStore, mirror)

    panel.create()
    panel.addSuccess(['TS'], {}, 10)
    panel.addSuccess(['RA'], {}, 20)
    await vi.waitFor(() => expect(writes).toHaveLength(2))

    const aKey = `${HISTORY_ENTRY_PREFIX}main:A`
    const bKey = `${HISTORY_ENTRY_PREFIX}main:B`
    const aWrite = writes.find((write) => Object.hasOwn(write.items, aKey))!
    const bWrite = writes.find((write) => Object.hasOwn(write.items, bKey))!
    expect(Object.keys(aWrite.items)).toEqual([aKey])
    expect(Object.keys(bWrite.items)).toEqual([bKey])
    expect(document.body.textContent).toContain('[TS]')
    expect(document.body.textContent).toContain('[RA]')

    const versionAfterOptimisticWrites = (panel as unknown as { recordsVersion: number }).recordsVersion
    commitWrite(api, persisted, bWrite)
    await vi.waitFor(() =>
      expect((panel as unknown as { recordsVersion: number }).recordsVersion).toBe(versionAfterOptimisticWrites + 1),
    )

    aWrite.reject(new Error('A failed'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('历史记录保存失败：Error: A failed'))

    expect(historyStore.get('main')).toMatchObject([{ type: 'success', answers: 'RA' }])
    expect(historyStore.get('main')).toHaveLength(1)
    expect([...persisted.keys()]).toEqual([bKey])
    expect(document.body.textContent).toContain('[RA]')
    expect(document.body.textContent).not.toContain('[TS]')

    panel.destroy()
    mirror.destroy()
  })
})
