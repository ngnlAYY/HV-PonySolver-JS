import { describe, expect, it, vi } from 'vitest'

import {
  HISTORY_ENTRY_PREFIX,
  HISTORY_KEY,
} from '@hv-pony-solver/browser-core/persistence/answer-history-config'
import { HistoryStore } from '@hv-pony-solver/browser-core/persistence/answer-history-store'
import type { EnumerableTextStorage } from '@hv-pony-solver/browser-core/platform/storage'

import { scheduleExperiencedPrefetch } from '../../src/content/prefetch'

class MemoryStorage implements EnumerableTextStorage {
  constructor(readonly items = new Map<string, string>()) {}

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }

  getItemsByPrefix(prefix: string): ReadonlyArray<readonly [key: string, value: string]> {
    return Array.from(this.items.entries()).filter(([key]) => key.startsWith(prefix))
  }
}

function validRecord(type: 'manual' | 'success' = 'success'): string {
  return JSON.stringify({ type, answers: 'TS', elapsed: 1 })
}

describe('scheduleExperiencedPrefetch', () => {
  it.each([
    ['keyed main', new Map([[`${HISTORY_ENTRY_PREFIX}main:one`, validRecord()]])],
    ['keyed isekai', new Map([[`${HISTORY_ENTRY_PREFIX}isekai:one`, validRecord('manual')]])],
    ['valid legacy', new Map([[HISTORY_KEY, `{"main":[${validRecord()}]}`]])],
  ])('prefetches once silently for %s history', async (_label, items) => {
    const detector = { prepare: vi.fn(async () => undefined) }
    scheduleExperiencedPrefetch(new HistoryStore(new MemoryStorage(items)), detector as never, () => undefined)

    await vi.waitFor(() => expect(detector.prepare).toHaveBeenCalledTimes(1))
    expect(detector.prepare).toHaveBeenCalledWith(undefined, { silent: true })
  })

  it.each([
    ['fresh install', new Map<string, string>()],
    ['empty legacy', new Map([[HISTORY_KEY, '{"main":[]}']])],
    ['corrupt legacy', new Map([[HISTORY_KEY, 'not-json']])],
    ['unknown legacy shape', new Map([[HISTORY_KEY, '{"unexpected":true}']])],
    ['invalid nonempty legacy record', new Map([[HISTORY_KEY, '{"main":[{"type":"success","answers":"TS","elapsed":"fast"}]}']])],
    ['invalid keyed record', new Map([[`${HISTORY_ENTRY_PREFIX}main:bad`, '{"type":"noop","elapsed":1}']])],
    ['error-only history', new Map([[`${HISTORY_ENTRY_PREFIX}main:err`, '{"type":"error","elapsed":1,"message":"识别失败"}']])],
  ])('stays lazy for %s', (_label, items) => {
    const detector = { prepare: vi.fn(async () => undefined) }
    scheduleExperiencedPrefetch(new HistoryStore(new MemoryStorage(items)), detector as never, () => undefined)

    expect(detector.prepare).not.toHaveBeenCalled()
  })

  it('swallows prefetch failures', async () => {
    const detector = { prepare: vi.fn(async () => Promise.reject(new Error('离线'))) }
    const storage = new MemoryStorage(new Map([[`${HISTORY_ENTRY_PREFIX}isekai:one`, validRecord('manual')]]))
    scheduleExperiencedPrefetch(new HistoryStore(storage), detector as never, () => undefined)

    await vi.waitFor(() => expect(detector.prepare).toHaveBeenCalledTimes(1))
    await expect(Promise.resolve()).resolves.toBeUndefined()
  })
})
