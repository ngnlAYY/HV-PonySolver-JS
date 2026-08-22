import { describe, expect, it, vi } from 'vitest'

import { HISTORY_KEY } from '@hv-pony-solver/browser-core/persistence/answer-history-config'

import { scheduleExperiencedPrefetch } from '../../src/content/prefetch'
import type { ExtensionStorageMirror } from '../../src/content/storage-mirror'

function storageWith(items: Record<string, string> = {}): ExtensionStorageMirror {
  return {
    getItem: (key: string) => items[key] ?? null,
  } as unknown as ExtensionStorageMirror
}

describe('scheduleExperiencedPrefetch', () => {
  it('prefetches the session once answer history exists', async () => {
    const detector = { prepare: vi.fn(async () => undefined) }
    scheduleExperiencedPrefetch(
      storageWith({ [HISTORY_KEY]: '{"main":[{"type":"success","answers":"TS","elapsed":1}]}' }),
      detector as never,
      () => undefined,
    )

    await vi.waitFor(() => expect(detector.prepare).toHaveBeenCalledTimes(1))
  })

  it('stays lazy for fresh installs and unreadable history', async () => {
    for (const items of [
      {},
      { [HISTORY_KEY]: '{}' },
      { [HISTORY_KEY]: '{"main":[]}' },
      { [HISTORY_KEY]: 'not-json' },
      { [HISTORY_KEY]: '{"unexpected":true}' },
    ]) {
      const detector = { prepare: vi.fn(async () => undefined) }
      scheduleExperiencedPrefetch(storageWith(items), detector as never, () => undefined)
      expect(detector.prepare).not.toHaveBeenCalled()
    }
  })

  it('swallows prefetch failures and aborted signals', async () => {
    const detector = { prepare: vi.fn(async () => Promise.reject(new Error('离线'))) }
    scheduleExperiencedPrefetch(
      storageWith({ [HISTORY_KEY]: '{"isekai":[{"type":"manual","answers":"FS","elapsed":2}]}' }),
      detector as never,
      () => undefined,
    )

    await vi.waitFor(() => expect(detector.prepare).toHaveBeenCalledTimes(1))
    await expect(Promise.resolve()).resolves.toBeUndefined()
  })
})
