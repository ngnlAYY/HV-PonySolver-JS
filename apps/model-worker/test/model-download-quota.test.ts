/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { reset, runInDurableObject } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

import type { ModelDownloadQuota } from '../src/model-download-quota'
import { consumeModelDownloadQuota, secondsUntilNextUtcMonth, utcMonthKey } from '../src/model-download-quota'
import type { ModelDownloadQuotaNamespace } from '../src/worker-types'

const quotaNamespace = (
  env as unknown as { MODEL_DOWNLOAD_QUOTAS: DurableObjectNamespace<ModelDownloadQuota> }
).MODEL_DOWNLOAD_QUOTAS

function createQuotaStub(): DurableObjectStub<ModelDownloadQuota> {
  return quotaNamespace.getByName(crypto.randomUUID())
}

function responseQuotaNamespace(response: Response): ModelDownloadQuotaNamespace {
  return {
    idFromName: (name) => ({ toString: () => name }) as DurableObjectId,
    get: () => ({ fetch: async () => response }),
  }
}

describe('ModelDownloadQuota', () => {
  afterEach(async () => {
    vi.useRealTimers()
    await reset()
  })

  it('rejects requests outside the internal consume contract', async () => {
    const quota = createQuotaStub()
    expect((await quota.fetch(new Request('https://quota.internal/consume'))).status).toBe(404)
    expect((await quota.fetch(new Request('https://quota.internal/other', { method: 'POST' }))).status).toBe(404)
  })

  it('allows five requests and rejects subsequent requests in the same UTC month', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'))
    const quota = createQuotaStub()

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
    const quota = createQuotaStub()
    await runInDurableObject(quota, async (_instance, state) => {
      await state.storage.put('monthly-download-quota', { month: 1, used: -1 })
    })

    await expect(
      (await quota.fetch(new Request('https://quota.internal/consume', { method: 'POST' }))).json(),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 1 })
    await runInDurableObject(quota, async (_instance, state) => {
      await state.storage.put('monthly-download-quota', { month: '2026-08', used: -1 })
    })
    await expect(
      (await quota.fetch(new Request('https://quota.internal/consume', { method: 'POST' }))).json(),
    ).resolves.toMatchObject({ allowed: true })
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
    await expect(
      (await quota.fetch(new Request('https://quota.internal/consume', { method: 'POST' }))).json(),
    ).resolves.toMatchObject({ allowed: true })
  })

  it('rejects failed and malformed internal quota responses', async () => {
    await expect(
      consumeModelDownloadQuota(responseQuotaNamespace(new Response('Unavailable', { status: 503 })), 'token'),
    ).rejects.toThrow('Model download quota service failed')
    await expect(
      consumeModelDownloadQuota(responseQuotaNamespace(Response.json(null)), 'token'),
    ).rejects.toThrow('Model download quota service returned an invalid response')
    await expect(
      consumeModelDownloadQuota(
        responseQuotaNamespace(Response.json({ allowed: true, retryAfterSeconds: 0 })),
        'token',
      ),
    ).rejects.toThrow('Model download quota service returned an invalid response')
  })

  it('accepts a valid internal quota response', async () => {
    await expect(
      consumeModelDownloadQuota(
        responseQuotaNamespace(Response.json({ allowed: true, retryAfterSeconds: 60 })),
        'token',
      ),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 60 })
  })

  it('aborts a hanging internal quota request after its deadline', async () => {
    vi.useFakeTimers()
    const namespace = {
      idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
      get: () => ({
        fetch: (request: Request) =>
          new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(new Error('quota request timed out')), {
              once: true,
            })
          }),
      }),
    } as unknown as ModelDownloadQuotaNamespace

    const pending = expect(consumeModelDownloadQuota(namespace, 'token')).rejects.toThrow('quota request timed out')
    await vi.advanceTimersByTimeAsync(5_000)
    await pending
  })

  it('calculates UTC month and retry boundaries deterministically', () => {
    const now = new Date('2026-12-31T23:59:59.001Z')
    expect(utcMonthKey(now)).toBe('2026-12')
    expect(secondsUntilNextUtcMonth(now)).toBe(1)
  })
})
