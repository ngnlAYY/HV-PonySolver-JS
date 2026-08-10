/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { afterEach, describe, expect, it, vi } from 'vitest'

import { MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

import { ModelDownloadQuota, secondsUntilNextUtcMonth, utcMonthKey } from '../src/model-download-quota'

class MemoryStorage {
  readonly values = new Map<string, unknown>()

  async transaction<T>(closure: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T> {
    const transaction = {
      get: async <V>(key: string): Promise<V | undefined> => this.values.get(key) as V | undefined,
      put: async <V>(key: string, value: V): Promise<void> => {
        this.values.set(key, value)
      },
    } as DurableObjectTransaction
    return closure(transaction)
  }
}

function createQuota(storage = new MemoryStorage()): ModelDownloadQuota {
  return new ModelDownloadQuota({ storage } as unknown as DurableObjectState, {})
}

describe('ModelDownloadQuota', () => {
  afterEach(() => vi.useRealTimers())

  it('rejects requests outside the internal consume contract', async () => {
    const quota = createQuota()
    expect((await quota.fetch(new Request('https://quota.internal/consume'))).status).toBe(404)
    expect((await quota.fetch(new Request('https://quota.internal/other', { method: 'POST' }))).status).toBe(404)
  })

  it('allows five requests and rejects subsequent requests in the same UTC month', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'))
    const quota = createQuota()

    for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT; index += 1) {
      await expect(
        (await quota.fetch(new Request('https://quota.internal/consume', { method: 'POST' }))).json(),
      ).resolves.toMatchObject({ allowed: true })
    }
    await expect(
      (await quota.fetch(new Request('https://quota.internal/consume', { method: 'POST' }))).json(),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 1_857_600 })
  })

  it('starts a new counter after UTC month rollover and ignores corrupt stored state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T23:59:59.500Z'))
    const storage = new MemoryStorage()
    storage.values.set('monthly-download-quota', { month: 1, used: -1 })
    const quota = createQuota(storage)

    await expect(
      (await quota.fetch(new Request('https://quota.internal/consume', { method: 'POST' }))).json(),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 1 })
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
    await expect(
      (await quota.fetch(new Request('https://quota.internal/consume', { method: 'POST' }))).json(),
    ).resolves.toMatchObject({ allowed: true })
  })

  it('calculates UTC month and retry boundaries deterministically', () => {
    const now = new Date('2026-12-31T23:59:59.001Z')
    expect(utcMonthKey(now)).toBe('2026-12')
    expect(secondsUntilNextUtcMonth(now)).toBe(1)
  })
})
