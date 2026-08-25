import { DurableObject } from 'cloudflare:workers'

import { MODEL_DOWNLOAD_RECEIPT_HEADER, MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

import type { ModelDownloadQuotaNamespace, ModelDownloadQuotaStub } from './worker-types'

// v1 charged a request before its response body reached the client. A fresh key
// intentionally drops those unverifiable counters when the receipt protocol is
// deployed; only cache-confirmed downloads are represented in v2.
const QUOTA_STATE_KEY = 'monthly-download-quota-v2'
const RESERVE_PATH = '/reserve'
const CONFIRM_PATH = '/confirm'
const STATUS_PATH = '/status'
const INTERNAL_RESERVE_URL = `https://model-download-quota.internal${RESERVE_PATH}`
const INTERNAL_CONFIRM_URL = `https://model-download-quota.internal${CONFIRM_PATH}`
const INTERNAL_STATUS_URL = `https://model-download-quota.internal${STATUS_PATH}`
const QUOTA_REQUEST_TIMEOUT_MS = 5_000
export const MODEL_DOWNLOAD_RESERVATION_TTL_MS = 10 * 60 * 1_000

const RECEIPT_ID_PATTERN = /^[0-9a-f]{32}$/

type StoredQuotaState = Readonly<{
  month: string
  used: number
  pending: Readonly<Record<string, number>>
  confirmed: readonly string[]
}>

export type ModelDownloadQuotaReservation =
  | Readonly<{
      allowed: true
      receiptId: string
      retryAfterSeconds: number
    }>
  | Readonly<{
      allowed: false
      reason: 'quota-exhausted' | 'reservations-full'
      retryAfterSeconds: number
    }>

export type ModelDownloadQuotaConfirmation = Readonly<{
  confirmed: boolean
  alreadyConfirmed: boolean
  used: number
  remaining: number
  retryAfterSeconds: number
}>

export type ModelDownloadQuotaStatus = Readonly<{
  limit: number
  used: number
  remaining: number
  retryAfterSeconds: number
}>

export function utcMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

export function secondsUntilNextUtcMonth(now: Date): number {
  const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  return Math.max(1, Math.ceil((nextMonth - now.getTime()) / 1000))
}

function isStoredQuotaState(value: unknown): value is StoredQuotaState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<StoredQuotaState>
  const used = candidate.used
  const pending = candidate.pending
  const confirmed = candidate.confirmed
  return (
    typeof candidate.month === 'string' &&
    typeof used === 'number' &&
    Number.isSafeInteger(used) &&
    used >= 0 &&
    used <= MODEL_MONTHLY_DOWNLOAD_LIMIT &&
    typeof pending === 'object' &&
    pending !== null &&
    !Array.isArray(pending) &&
    Object.entries(pending).every(
      ([receiptId, expiresAt]) =>
        RECEIPT_ID_PATTERN.test(receiptId) &&
        typeof expiresAt === 'number' &&
        Number.isSafeInteger(expiresAt) &&
        expiresAt > 0,
    ) &&
    Object.keys(pending).length <= MODEL_MONTHLY_DOWNLOAD_LIMIT &&
    Array.isArray(confirmed) &&
    confirmed.length <= MODEL_MONTHLY_DOWNLOAD_LIMIT &&
    confirmed.length === used &&
    confirmed.every((receiptId) => typeof receiptId === 'string' && RECEIPT_ID_PATTERN.test(receiptId)) &&
    new Set(confirmed).size === confirmed.length
  )
}

function isQuotaReservation(value: unknown): value is ModelDownloadQuotaReservation {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as {
    allowed?: unknown
    receiptId?: unknown
    reason?: unknown
    retryAfterSeconds?: unknown
  }
  const retryAfterSeconds = candidate.retryAfterSeconds
  if (typeof retryAfterSeconds !== 'number' || !Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 1) {
    return false
  }
  if (candidate.allowed === true) {
    return typeof candidate.receiptId === 'string' && RECEIPT_ID_PATTERN.test(candidate.receiptId)
  }
  return (
    candidate.allowed === false && (candidate.reason === 'quota-exhausted' || candidate.reason === 'reservations-full')
  )
}

function isQuotaConfirmation(value: unknown): value is ModelDownloadQuotaConfirmation {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<ModelDownloadQuotaConfirmation>
  return (
    typeof candidate.confirmed === 'boolean' &&
    typeof candidate.alreadyConfirmed === 'boolean' &&
    typeof candidate.used === 'number' &&
    Number.isSafeInteger(candidate.used) &&
    candidate.used >= 0 &&
    candidate.used <= MODEL_MONTHLY_DOWNLOAD_LIMIT &&
    typeof candidate.remaining === 'number' &&
    Number.isSafeInteger(candidate.remaining) &&
    candidate.remaining === MODEL_MONTHLY_DOWNLOAD_LIMIT - candidate.used &&
    typeof candidate.retryAfterSeconds === 'number' &&
    Number.isSafeInteger(candidate.retryAfterSeconds) &&
    candidate.retryAfterSeconds > 0 &&
    (!candidate.alreadyConfirmed || candidate.confirmed)
  )
}

function isQuotaStatus(value: unknown): value is ModelDownloadQuotaStatus {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<ModelDownloadQuotaStatus>
  const numbers = [candidate.limit, candidate.used, candidate.remaining, candidate.retryAfterSeconds]
  return (
    numbers.every((number) => typeof number === 'number' && Number.isSafeInteger(number)) &&
    candidate.limit! > 0 &&
    candidate.used! >= 0 &&
    candidate.used! <= candidate.limit! &&
    candidate.remaining! >= 0 &&
    candidate.remaining! === candidate.limit! - candidate.used! &&
    candidate.retryAfterSeconds! > 0
  )
}

function jsonResponse(
  value: ModelDownloadQuotaReservation | ModelDownloadQuotaConfirmation | ModelDownloadQuotaStatus,
): Response {
  return Response.json(value, { headers: { 'cache-control': 'no-store' } })
}

function createReceiptId(): string {
  return crypto.randomUUID().replaceAll('-', '').toLowerCase()
}

function createEmptyState(month: string): StoredQuotaState {
  return { month, used: 0, pending: {}, confirmed: [] }
}

function currentState(stored: unknown, month: string, nowMs: number): StoredQuotaState {
  const state = isStoredQuotaState(stored) && stored.month === month ? stored : createEmptyState(month)
  return {
    ...state,
    pending: Object.fromEntries(Object.entries(state.pending).filter(([, expiresAt]) => expiresAt > nowMs)),
  }
}

function reservationRetryAfterSeconds(state: StoredQuotaState, nowMs: number): number {
  const earliestExpiry = Math.min(...Object.values(state.pending))
  return Math.max(1, Math.ceil((earliestExpiry - nowMs) / 1_000))
}

function confirmationResult(
  state: StoredQuotaState,
  retryAfterSeconds: number,
  confirmed: boolean,
  alreadyConfirmed: boolean,
): ModelDownloadQuotaConfirmation {
  return {
    confirmed,
    alreadyConfirmed,
    used: state.used,
    remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT - state.used,
    retryAfterSeconds,
  }
}

export class ModelDownloadQuota extends DurableObject<Record<string, never>> {
  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if (
      (pathname !== RESERVE_PATH && pathname !== CONFIRM_PATH && pathname !== STATUS_PATH) ||
      request.method !== 'POST'
    ) {
      return new Response('Not Found', { status: 404 })
    }

    const receiptId = request.headers.get(MODEL_DOWNLOAD_RECEIPT_HEADER)?.trim().toLowerCase() ?? ''
    if (pathname === CONFIRM_PATH && !RECEIPT_ID_PATTERN.test(receiptId)) {
      return new Response('Bad Request', { status: 400 })
    }

    const now = new Date()
    const nowMs = now.getTime()
    const month = utcMonthKey(now)
    const retryAfterSeconds = secondsUntilNextUtcMonth(now)
    const result = await this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get<StoredQuotaState>(QUOTA_STATE_KEY)
      const state = currentState(stored, month, nowMs)
      if (pathname === STATUS_PATH) {
        await transaction.put(QUOTA_STATE_KEY, state)
        return {
          limit: MODEL_MONTHLY_DOWNLOAD_LIMIT,
          used: state.used,
          remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT - state.used,
          retryAfterSeconds,
        } satisfies ModelDownloadQuotaStatus
      }

      if (pathname === CONFIRM_PATH) {
        if (state.confirmed.includes(receiptId)) {
          await transaction.put(QUOTA_STATE_KEY, state)
          return confirmationResult(state, retryAfterSeconds, true, true)
        }
        if (!(receiptId in state.pending) || state.used >= MODEL_MONTHLY_DOWNLOAD_LIMIT) {
          await transaction.put(QUOTA_STATE_KEY, state)
          return confirmationResult(state, retryAfterSeconds, false, false)
        }
        const pending = { ...state.pending }
        delete pending[receiptId]
        const confirmedState: StoredQuotaState = {
          ...state,
          used: state.used + 1,
          pending,
          confirmed: [...state.confirmed, receiptId],
        }
        await transaction.put(QUOTA_STATE_KEY, confirmedState)
        return confirmationResult(confirmedState, retryAfterSeconds, true, false)
      }

      if (state.used >= MODEL_MONTHLY_DOWNLOAD_LIMIT) {
        await transaction.put(QUOTA_STATE_KEY, state)
        return { allowed: false, reason: 'quota-exhausted', retryAfterSeconds } as const
      }
      if (state.used + Object.keys(state.pending).length >= MODEL_MONTHLY_DOWNLOAD_LIMIT) {
        await transaction.put(QUOTA_STATE_KEY, state)
        return {
          allowed: false,
          reason: 'reservations-full',
          retryAfterSeconds: reservationRetryAfterSeconds(state, nowMs),
        } as const
      }
      let nextReceiptId = createReceiptId()
      /* istanbul ignore next -- a UUID collision is guarded but cannot be induced through the public crypto API */
      while (nextReceiptId in state.pending || state.confirmed.includes(nextReceiptId)) {
        nextReceiptId = createReceiptId()
      }
      const reservedState: StoredQuotaState = {
        ...state,
        pending: { ...state.pending, [nextReceiptId]: nowMs + MODEL_DOWNLOAD_RESERVATION_TTL_MS },
      }
      await transaction.put(QUOTA_STATE_KEY, reservedState)
      return { allowed: true, receiptId: nextReceiptId, retryAfterSeconds } as const
    })
    return jsonResponse(result)
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function quotaStub(namespace: ModelDownloadQuotaNamespace, canonicalToken: string): Promise<ModelDownloadQuotaStub> {
  return sha256Hex(canonicalToken).then((identity) => namespace.get(namespace.idFromName(identity)))
}

export async function reserveModelDownloadQuota(
  namespace: ModelDownloadQuotaNamespace,
  canonicalToken: string,
): Promise<ModelDownloadQuotaReservation> {
  const stub = await quotaStub(namespace, canonicalToken)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), QUOTA_REQUEST_TIMEOUT_MS)
  try {
    const response = await stub.fetch(new Request(INTERNAL_RESERVE_URL, { method: 'POST', signal: controller.signal }))
    if (!response.ok) {
      throw new Error('Model download quota service failed')
    }
    const result: unknown = await response.json()
    if (!isQuotaReservation(result)) {
      throw new Error('Model download quota service returned an invalid response')
    }
    return result
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function confirmModelDownloadQuota(
  namespace: ModelDownloadQuotaNamespace,
  canonicalToken: string,
  receiptId: string,
): Promise<ModelDownloadQuotaConfirmation> {
  const normalizedReceiptId = receiptId.trim().toLowerCase()
  if (!RECEIPT_ID_PATTERN.test(normalizedReceiptId)) {
    throw new Error('Model download receipt is invalid')
  }
  const stub = await quotaStub(namespace, canonicalToken)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), QUOTA_REQUEST_TIMEOUT_MS)
  try {
    const response = await stub.fetch(
      new Request(INTERNAL_CONFIRM_URL, {
        method: 'POST',
        headers: { [MODEL_DOWNLOAD_RECEIPT_HEADER]: normalizedReceiptId },
        signal: controller.signal,
      }),
    )
    if (!response.ok) {
      throw new Error('Model download quota service failed')
    }
    const result: unknown = await response.json()
    if (!isQuotaConfirmation(result)) {
      throw new Error('Model download quota service returned an invalid response')
    }
    return result
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function readModelDownloadQuota(
  namespace: ModelDownloadQuotaNamespace,
  canonicalToken: string,
): Promise<ModelDownloadQuotaStatus> {
  const stub = await quotaStub(namespace, canonicalToken)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), QUOTA_REQUEST_TIMEOUT_MS)
  try {
    const response = await stub.fetch(new Request(INTERNAL_STATUS_URL, { method: 'POST', signal: controller.signal }))
    if (!response.ok) {
      throw new Error('Model download quota service failed')
    }
    const result: unknown = await response.json()
    if (!isQuotaStatus(result)) {
      throw new Error('Model download quota service returned an invalid response')
    }
    return result
  } finally {
    clearTimeout(timeoutId)
  }
}
