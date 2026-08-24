import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HISTORY_ENTRY_PREFIX, HISTORY_KEY } from '@hv-pony-solver/browser-core/persistence/answer-history-config'
import { HistoryStore } from '@hv-pony-solver/browser-core/persistence/answer-history-store'
import type { EnumerableTextStorage } from '@hv-pony-solver/browser-core/platform/storage'

import {
  PREFETCH_MISS_LIMIT,
  PREFETCH_MISS_STORAGE_KEY,
  hasPrefetchBudget,
  recordPrefetchMiss,
  resetPrefetchMisses,
  scheduleExperiencedPrefetch,
} from '../../src/content/prefetch'

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

class FakeSessionStorage {
  readonly items = new Map<string, string>()

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }
}

function validRecord(type: 'manual' | 'success' = 'success'): string {
  return JSON.stringify({ type, answers: 'TS', elapsed: 1 })
}

function experiencedHistory(): HistoryStore {
  return new HistoryStore(new MemoryStorage(new Map([[`${HISTORY_ENTRY_PREFIX}isekai:one`, validRecord()]])))
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', new FakeSessionStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

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
    // The fired warm-up consumes one unit of idle budget.
    expect(globalThis.sessionStorage.getItem(PREFETCH_MISS_STORAGE_KEY)).toBe('1')
  })

  it.each([
    ['fresh install', new Map<string, string>()],
    ['empty legacy', new Map([[HISTORY_KEY, '{"main":[]}']])],
    ['corrupt legacy', new Map([[HISTORY_KEY, 'not-json']])],
    ['unknown legacy shape', new Map([[HISTORY_KEY, '{"unexpected":true}']])],
    [
      'invalid nonempty legacy record',
      new Map([[HISTORY_KEY, '{"main":[{"type":"success","answers":"TS","elapsed":"fast"}]}']]),
    ],
    ['invalid keyed record', new Map([[`${HISTORY_ENTRY_PREFIX}main:bad`, '{"type":"noop","elapsed":1}']])],
    [
      'error-only history',
      new Map([[`${HISTORY_ENTRY_PREFIX}main:err`, '{"type":"error","elapsed":1,"message":"识别失败"}']]),
    ],
  ])('stays lazy for %s', (_label, items) => {
    const detector = { prepare: vi.fn(async () => undefined) }
    scheduleExperiencedPrefetch(new HistoryStore(new MemoryStorage(items)), detector as never, () => undefined)

    expect(detector.prepare).not.toHaveBeenCalled()
    expect(globalThis.sessionStorage.getItem(PREFETCH_MISS_STORAGE_KEY)).toBeNull()
  })

  it('swallows prefetch failures', async () => {
    const detector = { prepare: vi.fn(async () => Promise.reject(new Error('离线'))) }
    const storage = new MemoryStorage(new Map([[`${HISTORY_ENTRY_PREFIX}isekai:one`, validRecord('manual')]]))
    scheduleExperiencedPrefetch(new HistoryStore(storage), detector as never, () => undefined)

    await vi.waitFor(() => expect(detector.prepare).toHaveBeenCalledTimes(1))
    await expect(Promise.resolve()).resolves.toBeUndefined()
  })
})

describe('prefetch idle backoff', () => {
  it('skips the prefetch once the session accumulated the miss limit', () => {
    globalThis.sessionStorage.setItem(PREFETCH_MISS_STORAGE_KEY, String(PREFETCH_MISS_LIMIT))
    const detector = { prepare: vi.fn(async () => undefined) }

    scheduleExperiencedPrefetch(experiencedHistory(), detector as never, () => undefined)

    expect(detector.prepare).not.toHaveBeenCalled()
    expect(globalThis.sessionStorage.getItem(PREFETCH_MISS_STORAGE_KEY)).toBe(String(PREFETCH_MISS_LIMIT))
  })

  it('still fires on the page that reaches exactly the limit', async () => {
    globalThis.sessionStorage.setItem(PREFETCH_MISS_STORAGE_KEY, String(PREFETCH_MISS_LIMIT - 1))
    const detector = { prepare: vi.fn(async () => undefined) }

    scheduleExperiencedPrefetch(experiencedHistory(), detector as never, () => undefined)

    await vi.waitFor(() => expect(detector.prepare).toHaveBeenCalledTimes(1))
    expect(globalThis.sessionStorage.getItem(PREFETCH_MISS_STORAGE_KEY)).toBe(String(PREFETCH_MISS_LIMIT))
  })

  it('self-heals a corrupt counter back to zero', async () => {
    globalThis.sessionStorage.setItem(PREFETCH_MISS_STORAGE_KEY, 'not-a-number')
    const detector = { prepare: vi.fn(async () => undefined) }

    scheduleExperiencedPrefetch(experiencedHistory(), detector as never, () => undefined)

    await vi.waitFor(() => expect(detector.prepare).toHaveBeenCalledTimes(1))
    expect(globalThis.sessionStorage.getItem(PREFETCH_MISS_STORAGE_KEY)).toBe('1')
  })

  it('keeps the legacy always-warm behavior when sessionStorage is unavailable', async () => {
    vi.stubGlobal(
      'sessionStorage',
      new Proxy(
        {},
        {
          get() {
            throw new Error('SecurityError')
          },
        },
      ),
    )
    const detector = { prepare: vi.fn(async () => undefined) }

    scheduleExperiencedPrefetch(experiencedHistory(), detector as never, () => undefined)

    await vi.waitFor(() => expect(detector.prepare).toHaveBeenCalledTimes(1))
  })

  it('keeps prefetching when persisting the counter fails', async () => {
    const hostile = new FakeSessionStorage()
    hostile.setItem = (key) => {
      if (key === PREFETCH_MISS_STORAGE_KEY) {
        throw new Error('QuotaExceededError')
      }
    }
    vi.stubGlobal('sessionStorage', hostile)
    const detector = { prepare: vi.fn(async () => undefined) }

    scheduleExperiencedPrefetch(experiencedHistory(), detector as never, () => undefined)

    await vi.waitFor(() => expect(detector.prepare).toHaveBeenCalledTimes(1))
  })

  it('re-arms the full budget after the counter resets and treats negative counts as zero', () => {
    globalThis.sessionStorage.setItem(PREFETCH_MISS_STORAGE_KEY, '-7')
    expect(hasPrefetchBudget()).toBe(true)
    recordPrefetchMiss()
    expect(globalThis.sessionStorage.getItem(PREFETCH_MISS_STORAGE_KEY)).toBe('1')

    resetPrefetchMisses()
    expect(globalThis.sessionStorage.getItem(PREFETCH_MISS_STORAGE_KEY)).toBeNull()
    expect(hasPrefetchBudget()).toBe(true)

    globalThis.sessionStorage.setItem(PREFETCH_MISS_STORAGE_KEY, String(PREFETCH_MISS_LIMIT))
    expect(hasPrefetchBudget()).toBe(false)
    resetPrefetchMisses()
    expect(hasPrefetchBudget()).toBe(true)
  })
})
