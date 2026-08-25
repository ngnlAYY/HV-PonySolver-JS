import { DurableObject } from 'cloudflare:workers'

import { MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

import type { ModelDownloadQuotaNamespace } from './worker-types'

const QUOTA_STATE_KEY = 'monthly-download-quota'
const CONSUME_PATH = '/consume'
const STATUS_PATH = '/status'
const INTERNAL_CONSUME_URL = `https://model-download-quota.internal${CONSUME_PATH}`
const INTERNAL_STATUS_URL = `https://model-download-quota.internal${STATUS_PATH}`
const QUOTA_REQUEST_TIMEOUT_MS = 5_000

type StoredQuotaState = Readonly<{
  month: string
  used: number
}>

export type ModelDownloadQuotaResult = Readonly<{
  allowed: boolean
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
  return typeof candidate.month === 'string' && typeof used === 'number' && Number.isSafeInteger(used) && used >= 0
}

function isQuotaResult(value: unknown): value is ModelDownloadQuotaResult {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<ModelDownloadQuotaResult>
  const retryAfterSeconds = candidate.retryAfterSeconds
  return (
    typeof candidate.allowed === 'boolean' &&
    typeof retryAfterSeconds === 'number' &&
    Number.isSafeInteger(retryAfterSeconds) &&
    retryAfterSeconds > 0
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

function jsonResponse(value: ModelDownloadQuotaResult | ModelDownloadQuotaStatus): Response {
  return Response.json(value, { headers: { 'cache-control': 'no-store' } })
}

export class ModelDownloadQuota extends DurableObject<Record<string, never>> {
  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname
    if ((pathname !== CONSUME_PATH && pathname !== STATUS_PATH) || request.method !== 'POST') {
      return new Response('Not Found', { status: 404 })
    }

    const now = new Date()
    const month = utcMonthKey(now)
    const retryAfterSeconds = secondsUntilNextUtcMonth(now)
    const result = await this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get<StoredQuotaState>(QUOTA_STATE_KEY)
      const used =
        isStoredQuotaState(stored) && stored.month === month ? Math.min(stored.used, MODEL_MONTHLY_DOWNLOAD_LIMIT) : 0
      if (pathname === STATUS_PATH) {
        return {
          limit: MODEL_MONTHLY_DOWNLOAD_LIMIT,
          used,
          remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT - used,
          retryAfterSeconds,
        } satisfies ModelDownloadQuotaStatus
      }
      if (used >= MODEL_MONTHLY_DOWNLOAD_LIMIT) {
        return { allowed: false, retryAfterSeconds } as const
      }
      await transaction.put(QUOTA_STATE_KEY, { month, used: used + 1 } satisfies StoredQuotaState)
      return { allowed: true, retryAfterSeconds } as const
    })
    return jsonResponse(result)
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function consumeModelDownloadQuota(
  namespace: ModelDownloadQuotaNamespace,
  canonicalToken: string,
): Promise<ModelDownloadQuotaResult> {
  const identity = await sha256Hex(canonicalToken)
  const stub = namespace.get(namespace.idFromName(identity))
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), QUOTA_REQUEST_TIMEOUT_MS)
  try {
    const response = await stub.fetch(new Request(INTERNAL_CONSUME_URL, { method: 'POST', signal: controller.signal }))
    if (!response.ok) {
      throw new Error('Model download quota service failed')
    }
    const result: unknown = await response.json()
    if (!isQuotaResult(result)) {
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
  const identity = await sha256Hex(canonicalToken)
  const stub = namespace.get(namespace.idFromName(identity))
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
