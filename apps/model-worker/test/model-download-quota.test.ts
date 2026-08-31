/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from 'cloudflare:workers'
import { reset, runInDurableObject } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MODEL_DOWNLOAD_RECEIPT_HEADER, MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

import type { ModelDownloadQuota } from '../src/model-download-quota'
import {
  confirmModelDownloadQuota,
  MODEL_DOWNLOAD_RESERVATION_TTL_MS,
  readModelDownloadQuota,
  reserveModelDownloadQuota,
  secondsUntilNextUtcMonth,
  utcMonthKey,
} from '../src/model-download-quota'
import type { ModelDownloadQuotaNamespace } from '../src/worker-types'

const quotaNamespace = (env as unknown as { MODEL_DOWNLOAD_QUOTAS: DurableObjectNamespace<ModelDownloadQuota> })
  .MODEL_DOWNLOAD_QUOTAS
const RECEIPT_ID = 'a'.repeat(32)

function createQuotaStub(): DurableObjectStub<ModelDownloadQuota> {
  return quotaNamespace.getByName(crypto.randomUUID())
}

function responseQuotaNamespace(response: Response): ModelDownloadQuotaNamespace {
  return {
    idFromName: (name) => ({ toString: () => name }) as DurableObjectId,
    get: () => ({ fetch: async () => response }),
  }
}

async function reserve(quota: DurableObjectStub<ModelDownloadQuota>): Promise<string> {
  const value = (await (
    await quota.fetch(new Request('https://quota.internal/reserve', { method: 'POST' }))
  ).json()) as { receiptId: string }
  return value.receiptId
}

async function confirm(quota: DurableObjectStub<ModelDownloadQuota>, receiptId: string): Promise<Response> {
  return quota.fetch(
    new Request('https://quota.internal/confirm', {
      method: 'POST',
      headers: { [MODEL_DOWNLOAD_RECEIPT_HEADER]: receiptId },
    }),
  )
}

describe('ModelDownloadQuota', () => {
  afterEach(async () => {
    vi.useRealTimers()
    await reset()
  })

  it('rejects requests outside the internal reserve, confirm, and status contract', async () => {
    const quota = createQuotaStub()
    expect((await quota.fetch(new Request('https://quota.internal/reserve'))).status).toBe(404)
    expect((await quota.fetch(new Request('https://quota.internal/status'))).status).toBe(404)
    expect((await quota.fetch(new Request('https://quota.internal/other', { method: 'POST' }))).status).toBe(404)
    expect((await quota.fetch(new Request('https://quota.internal/confirm', { method: 'POST' }))).status).toBe(400)
  })

  it('counts only a cache confirmation and makes repeated confirmation idempotent', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'))
    const quota = createQuotaStub()

    const receiptId = await reserve(quota)
    await expect(
      (await quota.fetch(new Request('https://quota.internal/status', { method: 'POST' }))).json(),
    ).resolves.toMatchObject({ used: 0, remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT })

    await expect((await confirm(quota, receiptId)).json()).resolves.toEqual({
      confirmed: true,
      alreadyConfirmed: false,
      used: 1,
      remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT - 1,
      retryAfterSeconds: 1_857_600,
    })
    await expect((await confirm(quota, receiptId)).json()).resolves.toMatchObject({
      confirmed: true,
      alreadyConfirmed: true,
      used: 1,
    })
  })

  it('does not inherit legacy request-time charges into receipt-backed counters', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'))
    const quota = createQuotaStub()
    await runInDurableObject(quota, async (_instance, state) => {
      await state.storage.put('monthly-download-quota', { month: '2026-08', used: MODEL_MONTHLY_DOWNLOAD_LIMIT })
    })

    await expect(
      (await quota.fetch(new Request('https://quota.internal/status', { method: 'POST' }))).json(),
    ).resolves.toMatchObject({ used: 0, remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT })
  })

  it('holds at most five reservations and reports exhaustion only after all five are confirmed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'))
    const quota = createQuotaStub()
    const receiptIds: string[] = []

    for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT; index += 1) {
      receiptIds.push(await reserve(quota))
    }
    await expect(
      (await quota.fetch(new Request('https://quota.internal/reserve', { method: 'POST' }))).json(),
    ).resolves.toEqual({
      allowed: false,
      reason: 'reservations-full',
      retryAfterSeconds: MODEL_DOWNLOAD_RESERVATION_TTL_MS / 1_000,
    })

    for (const receiptId of receiptIds) await confirm(quota, receiptId)
    await expect(
      (await quota.fetch(new Request('https://quota.internal/reserve', { method: 'POST' }))).json(),
    ).resolves.toEqual({ allowed: false, reason: 'quota-exhausted', retryAfterSeconds: 1_857_600 })
  })

  it('serializes concurrent reservations and duplicate confirmations in the real Durable Object', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'))
    const quota = createQuotaStub()
    const reservationResults = (await Promise.all(
      Array.from({ length: MODEL_MONTHLY_DOWNLOAD_LIMIT * 2 }, async () =>
        (await quota.fetch(new Request('https://quota.internal/reserve', { method: 'POST' }))).json(),
      ),
    )) as Array<
      | { allowed: true; receiptId: string; retryAfterSeconds: number }
      | { allowed: false; reason: string; retryAfterSeconds: number }
    >
    const receiptIds = reservationResults.flatMap((result) => (result.allowed ? [result.receiptId] : []))
    const deniedReservations = reservationResults.filter((result) => !result.allowed)

    expect(receiptIds).toHaveLength(MODEL_MONTHLY_DOWNLOAD_LIMIT)
    expect(new Set(receiptIds).size).toBe(MODEL_MONTHLY_DOWNLOAD_LIMIT)
    expect(deniedReservations).toHaveLength(MODEL_MONTHLY_DOWNLOAD_LIMIT)
    expect(deniedReservations).toEqual(
      expect.arrayContaining(
        Array.from({ length: MODEL_MONTHLY_DOWNLOAD_LIMIT }, () =>
          expect.objectContaining({ allowed: false, reason: 'reservations-full' }),
        ),
      ),
    )

    const confirmationResults = (await Promise.all(
      receiptIds.flatMap((receiptId) =>
        [confirm(quota, receiptId), confirm(quota, receiptId)].map(async (responsePromise) =>
          (await responsePromise).json(),
        ),
      ),
    )) as Array<{ confirmed: boolean; alreadyConfirmed: boolean; used: number }>

    expect(confirmationResults).toHaveLength(MODEL_MONTHLY_DOWNLOAD_LIMIT * 2)
    expect(confirmationResults.every((result) => result.confirmed)).toBe(true)
    expect(confirmationResults.filter((result) => !result.alreadyConfirmed)).toHaveLength(MODEL_MONTHLY_DOWNLOAD_LIMIT)
    expect(confirmationResults.filter((result) => result.alreadyConfirmed)).toHaveLength(MODEL_MONTHLY_DOWNLOAD_LIMIT)
    await expect(
      (await quota.fetch(new Request('https://quota.internal/status', { method: 'POST' }))).json(),
    ).resolves.toMatchObject({ used: MODEL_MONTHLY_DOWNLOAD_LIMIT, remaining: 0 })
  })

  it('releases unconfirmed reservations after their TTL and starts fresh on month rollover', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T23:40:00.000Z'))
    const quota = createQuotaStub()
    for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT; index += 1) await reserve(quota)

    vi.advanceTimersByTime(MODEL_DOWNLOAD_RESERVATION_TTL_MS)
    await expect(
      (await quota.fetch(new Request('https://quota.internal/reserve', { method: 'POST' }))).json(),
    ).resolves.toMatchObject({ allowed: true })

    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'))
    await expect((await confirm(quota, RECEIPT_ID)).json()).resolves.toMatchObject({ confirmed: false, used: 0 })
  })

  it('fails closed and preserves malformed persisted quota states', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'))
    const malformedStates = [
      'invalid',
      { month: 'invalid', used: 0, pending: {}, confirmed: [] },
      { month: '2026-08', used: 4, pending: { [RECEIPT_ID]: Date.now() + 60_000 }, confirmed: [] },
    ]

    for (const malformedState of malformedStates) {
      const quota = createQuotaStub()
      await runInDurableObject(quota, async (_instance, state) => {
        await state.storage.put('monthly-download-quota-v2', malformedState)
      })

      await expect(
        runInDurableObject(quota, (instance) =>
          instance.fetch(new Request('https://quota.internal/status', { method: 'POST' })),
        ),
      ).rejects.toThrow('quota state is invalid')
      await expect(
        runInDurableObject(quota, async (_instance, state) => state.storage.get('monthly-download-quota-v2')),
      ).resolves.toEqual(malformedState)
    }
  })

  it('does not create persisted state for read-only status queries', async () => {
    const quota = createQuotaStub()

    await expect(
      (await quota.fetch(new Request('https://quota.internal/status', { method: 'POST' }))).json(),
    ).resolves.toMatchObject({ used: 0, remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT })
    await expect(
      runInDurableObject(quota, async (_instance, state) => state.storage.get('monthly-download-quota-v2')),
    ).resolves.toBeUndefined()
  })

  it('validates failed and malformed internal quota responses and receipt input', async () => {
    const unavailable = responseQuotaNamespace(new Response('Unavailable', { status: 503 }))
    await expect(reserveModelDownloadQuota(unavailable, 'token')).rejects.toThrow('quota service failed')
    await expect(readModelDownloadQuota(unavailable, 'token')).rejects.toThrow('quota service failed')
    await expect(confirmModelDownloadQuota(unavailable, 'token', RECEIPT_ID)).rejects.toThrow('quota service failed')
    await expect(confirmModelDownloadQuota(unavailable, 'token', 'invalid')).rejects.toThrow('receipt is invalid')

    for (const operation of [
      () => reserveModelDownloadQuota(responseQuotaNamespace(Response.json(null)), 'token'),
      () =>
        reserveModelDownloadQuota(
          responseQuotaNamespace(Response.json({ allowed: true, receiptId: 'bad', retryAfterSeconds: 60 })),
          'token',
        ),
      () =>
        reserveModelDownloadQuota(
          responseQuotaNamespace(Response.json({ allowed: true, receiptId: RECEIPT_ID, retryAfterSeconds: 0 })),
          'token',
        ),
      () => readModelDownloadQuota(responseQuotaNamespace(Response.json(null)), 'token'),
      () => confirmModelDownloadQuota(responseQuotaNamespace(Response.json(null)), 'token', RECEIPT_ID),
      () =>
        confirmModelDownloadQuota(
          responseQuotaNamespace(
            Response.json({
              confirmed: false,
              alreadyConfirmed: true,
              used: 0,
              remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT,
              retryAfterSeconds: 60,
            }),
          ),
          'token',
          RECEIPT_ID,
        ),
    ]) {
      await expect(operation()).rejects.toThrow('invalid response')
    }
  })

  it('accepts valid internal reserve, confirmation, and status responses', async () => {
    await expect(
      reserveModelDownloadQuota(
        responseQuotaNamespace(Response.json({ allowed: true, receiptId: RECEIPT_ID, retryAfterSeconds: 60 })),
        'token',
      ),
    ).resolves.toEqual({ allowed: true, receiptId: RECEIPT_ID, retryAfterSeconds: 60 })
    await expect(
      confirmModelDownloadQuota(
        responseQuotaNamespace(
          Response.json({
            confirmed: true,
            alreadyConfirmed: false,
            used: 2,
            remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT - 2,
            retryAfterSeconds: 60,
          }),
        ),
        'token',
        RECEIPT_ID,
      ),
    ).resolves.toMatchObject({ confirmed: true, used: 2 })
    await expect(
      readModelDownloadQuota(
        responseQuotaNamespace(
          Response.json({
            limit: MODEL_MONTHLY_DOWNLOAD_LIMIT,
            used: 2,
            remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT - 2,
            retryAfterSeconds: 60,
          }),
        ),
        'token',
      ),
    ).resolves.toMatchObject({ used: 2 })
  })

  it('aborts hanging internal quota requests after their deadline', async () => {
    vi.useFakeTimers()
    const namespace = {
      idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
      get: () => ({
        fetch: (request: Request) =>
          new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(new Error('quota request timed out')), { once: true })
          }),
      }),
    } as unknown as ModelDownloadQuotaNamespace

    const pending = [
      expect(reserveModelDownloadQuota(namespace, 'token')).rejects.toThrow('quota request dependency timed out'),
      expect(readModelDownloadQuota(namespace, 'token')).rejects.toThrow('quota request dependency timed out'),
      expect(confirmModelDownloadQuota(namespace, 'token', RECEIPT_ID)).rejects.toThrow(
        'quota request dependency timed out',
      ),
    ]
    await vi.advanceTimersByTimeAsync(5_000)
    await Promise.all(pending)
  })

  it('rejects at the deadline even when an internal quota stub ignores abort', async () => {
    vi.useFakeTimers()
    const namespace = {
      idFromName: (name: string) => ({ toString: () => name }) as DurableObjectId,
      get: () => ({ fetch: () => new Promise<Response>(() => undefined) }),
    } as unknown as ModelDownloadQuotaNamespace
    const pending = reserveModelDownloadQuota(namespace, 'token').then(
      () => ({ status: 'resolved' as const, error: null }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    )

    await vi.advanceTimersByTimeAsync(5_000)
    const outcome = await Promise.race([pending, Promise.resolve({ status: 'pending' as const, error: null })])

    expect(outcome.status).toBe('rejected')
    expect(outcome.error).toBeInstanceOf(Error)
    expect((outcome.error as Error).message).toContain('quota request dependency timed out')
  })

  it('calculates UTC month and retry boundaries deterministically', () => {
    const now = new Date('2026-12-31T23:59:59.001Z')
    expect(utcMonthKey(now)).toBe('2026-12')
    expect(secondsUntilNextUtcMonth(now)).toBe(1)
  })
})
