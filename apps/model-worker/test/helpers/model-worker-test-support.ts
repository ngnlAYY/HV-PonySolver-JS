import { expect } from 'vitest'

import { MODEL_DOWNLOAD_RECEIPT_HEADER } from '@hv-pony-solver/shared'

import { fetchWorker, modelRequest, quotaRequest } from './model-worker-fixture'
import type { ModelFixture } from './model-worker-fixture'

export const HENTAIVERSE_ORIGIN = 'https://hentaiverse.org'
export const ALT_HENTAIVERSE_ORIGIN = 'https://alt.hentaiverse.org'
export const CANONICAL_ACCESS_TOKEN = '0123456789abcdef'.repeat(4)
export const UPPERCASE_ACCESS_TOKEN = CANONICAL_ACCESS_TOKEN.toUpperCase()
export const MIXED_CASE_ACCESS_TOKEN = '0123456789abcdefABCDEF0123456789'.repeat(2)

export function expectVaryOrigin(headers: Headers): void {
  const varyTokens = headers
    .get('vary')
    ?.split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)

  expect(varyTokens).toContain('origin')
}

export function authorizedModelRequest(
  fixture: ModelFixture,
  method: string,
  token: string = fixture.validKey,
  headers: Record<string, string> = {},
): Request {
  return modelRequest(fixture, method, undefined, {
    ...headers,
    authorization: `Bearer ${token}`,
  })
}

export async function confirmDownloadedModel(
  fixture: ModelFixture,
  env: Parameters<typeof fetchWorker>[1],
  download: Response,
  token: string = fixture.validKey,
): Promise<Response> {
  const receiptId = download.headers.get(MODEL_DOWNLOAD_RECEIPT_HEADER)
  expect(receiptId).toMatch(/^[0-9a-f]{32}$/)
  expect(download.headers.get('access-control-expose-headers')).toBe(MODEL_DOWNLOAD_RECEIPT_HEADER)
  const response = await fetchWorker(
    quotaRequest(fixture, 'POST', undefined, {
      authorization: `Bearer ${token}`,
      [MODEL_DOWNLOAD_RECEIPT_HEADER]: receiptId!,
    }),
    env,
  )
  expect(response.status).toBe(200)
  return response
}
