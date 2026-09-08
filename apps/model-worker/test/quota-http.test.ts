/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, expect, it, vi } from 'vitest'

import { MODEL_DOWNLOAD_RECEIPT_HEADER, MODEL_INTEGRITY, MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

import {
  assetRequest,
  createEnv,
  createModelFixture,
  fetchWorker,
  type MockR2Bucket,
  type MockModelDownloadQuotaNamespace,
  modelRequest,
  quotaRequest,
} from './helpers/model-worker-fixture'
import {
  CANONICAL_ACCESS_TOKEN,
  HENTAIVERSE_ORIGIN,
  UPPERCASE_ACCESS_TOKEN,
  authorizedModelRequest,
  confirmDownloadedModel,
  expectVaryOrigin,
} from './helpers/model-worker-test-support'

describe('quota-http', () => {
  it('returns a per-Key quota status without consuming a download', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })
    const headers = { authorization: `Bearer ${fixture.validKey}`, origin: HENTAIVERSE_ORIGIN }

    const first = await fetchWorker(quotaRequest(fixture, 'GET', undefined, headers), env)
    const second = await fetchWorker(quotaRequest(fixture, 'GET', undefined, headers), env)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    await expect(first.json()).resolves.toEqual({
      enabled: true,
      limit: MODEL_MONTHLY_DOWNLOAD_LIMIT,
      used: 0,
      remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT,
      retryAfterSeconds: expect.any(Number),
    })
    await expect(second.json()).resolves.toEqual(
      expect.objectContaining({ used: 0, remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT }),
    )
    expect(first.headers.get('content-type')).toContain('application/json')
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(first.headers.get('access-control-allow-origin')).toBe(HENTAIVERSE_ORIGIN)
    expectVaryOrigin(first.headers)
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedIdentities).toHaveLength(2)

    const download = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)
    await download.arrayBuffer()
    const beforeConfirmation = await fetchWorker(quotaRequest(fixture, 'GET', undefined, headers), env)
    await expect(beforeConfirmation.json()).resolves.toEqual(
      expect.objectContaining({ used: 0, remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT }),
    )
    await confirmDownloadedModel(fixture, env, download)
    const afterDownload = await fetchWorker(quotaRequest(fixture, 'GET', undefined, headers), env)
    await expect(afterDownload.json()).resolves.toEqual(
      expect.objectContaining({ used: 1, remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT - 1 }),
    )
  })

  it('rechecks quota at reservation when another download consumes the last slot after preflight', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })
    for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT - 1; index += 1) {
      const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)
      await response.arrayBuffer()
      await confirmDownloadedModel(fixture, env, response)
    }
    const readObject = env.MODEL_BUCKET.get.bind(env.MODEL_BUCKET)
    const getObject = vi.spyOn(env.MODEL_BUCKET, 'get').mockImplementationOnce(async (key) => {
      const competingDownload = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)
      expect(competingDownload.status).toBe(200)
      await competingDownload.arrayBuffer()
      await confirmDownloadedModel(fixture, env, competingDownload)
      return readObject(key)
    })

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)

    expect(response.status).toBe(429)
    expect(response.headers.has(MODEL_DOWNLOAD_RECEIPT_HEADER)).toBe(false)
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedPaths.at(-1)).toBe('/reserve')
    const object = await getObject.mock.results[0]?.value
    expect(await object?.body.getReader().read()).toEqual({ done: true, value: undefined })
  })

  it('requires a valid Bearer Key for quota status even in decoy mode', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })

    const response = await fetchWorker(quotaRequest(fixture, 'GET', fixture.validKey), env)

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedIdentities).toEqual([])
  })

  it('rejects missing, malformed, and expired download confirmations without increasing usage', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })
    const authorization = `Bearer ${fixture.validKey}`

    for (const receiptId of ['', 'invalid']) {
      const response = await fetchWorker(
        quotaRequest(fixture, 'POST', undefined, {
          authorization,
          ...(receiptId ? { [MODEL_DOWNLOAD_RECEIPT_HEADER]: receiptId } : {}),
        }),
        env,
      )
      expect(response.status).toBe(400)
    }
    const expired = await fetchWorker(
      quotaRequest(fixture, 'POST', undefined, {
        authorization,
        [MODEL_DOWNLOAD_RECEIPT_HEADER]: 'f'.repeat(32),
      }),
      env,
    )
    expect(expired.status).toBe(409)
    const status = await fetchWorker(quotaRequest(fixture, 'GET', undefined, { authorization }), env)
    await expect(status.json()).resolves.toMatchObject({ used: 0 })
  })

  it('returns a disabled quota status and does not call quota storage when enforcement is off', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map([[fixture.validKey, '1']]),
      quotaEnabled: false,
    })

    const quota = await fetchWorker(
      quotaRequest(fixture, 'GET', undefined, { authorization: `Bearer ${fixture.validKey}` }),
      env,
    )
    await expect(quota.json()).resolves.toEqual({
      enabled: false,
      limit: 0,
      used: 0,
      remaining: null,
      retryAfterSeconds: null,
    })
    const disabledConfirmation = await fetchWorker(
      quotaRequest(fixture, 'POST', undefined, {
        authorization: `Bearer ${fixture.validKey}`,
        [MODEL_DOWNLOAD_RECEIPT_HEADER]: 'a'.repeat(32),
      }),
      env,
    )
    expect(disabledConfirmation.status).toBe(409)
    expect(await disabledConfirmation.text()).toBe('Model download quota is disabled')
    const malformedConfirmation = await fetchWorker(
      quotaRequest(fixture, 'POST', undefined, {
        authorization: `Bearer ${fixture.validKey}`,
        [MODEL_DOWNLOAD_RECEIPT_HEADER]: 'invalid',
      }),
      env,
    )
    expect(malformedConfirmation.status).toBe(400)
    expect(await malformedConfirmation.text()).toBe('Invalid model download receipt')
    for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT + 1; index += 1) {
      const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)
      expect(response.status).toBe(200)
      await response.arrayBuffer()
    }
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedIdentities).toEqual([])
  })

  it('uses a quota-specific Allow header and returns a retryable error when status storage fails', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map([[fixture.validKey, '1']]),
      quotaStatusError: new Error('quota status unavailable'),
    })
    const bucket = env.MODEL_BUCKET as MockR2Bucket

    const methodResponse = await fetchWorker(quotaRequest(fixture, 'HEAD'), env)
    expect(methodResponse.status).toBe(405)
    expect(methodResponse.headers.get('allow')).toBe('GET, POST, OPTIONS')

    const failureResponse = await fetchWorker(
      quotaRequest(fixture, 'GET', undefined, { authorization: `Bearer ${fixture.validKey}` }),
      env,
    )
    expect(failureResponse.status).toBe(503)
    expect(failureResponse.headers.get('retry-after')).toBe('5')
    expect(await failureResponse.text()).toBe('Service Unavailable')
    expect(bucket.requestedKeys).toEqual([])
  })

  it('shares one five-download quota across ONNX, ORT, and canonical token casing', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[CANONICAL_ACCESS_TOKEN, '1']]) })
    const origin = HENTAIVERSE_ORIGIN

    for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT; index += 1) {
      const request =
        index % 2 === 0
          ? authorizedModelRequest(fixture, 'GET', index === 0 ? UPPERCASE_ACCESS_TOKEN : CANONICAL_ACCESS_TOKEN)
          : assetRequest(fixture.publicOrtModelPath, 'GET', {
              authorization: `Bearer ${index === 1 ? UPPERCASE_ACCESS_TOKEN : CANONICAL_ACCESS_TOKEN}`,
            })
      const response = await fetchWorker(request, env)
      expect(response.status).toBe(200)
      await response.arrayBuffer()
      await confirmDownloadedModel(fixture, env, response, CANONICAL_ACCESS_TOKEN)
    }

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET', CANONICAL_ACCESS_TOKEN, { origin }), env)
    expect(response.status).toBe(429)
    expect(await response.text()).toBe('Monthly model download quota exceeded')
    expect(response.headers.get('retry-after')).toMatch(/^[1-9][0-9]*$/)
    expect(response.headers.get('access-control-expose-headers')).toBe('Retry-After')
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')

    const quota = env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace
    expect(quota.requestedIdentities).toHaveLength(MODEL_MONTHLY_DOWNLOAD_LIMIT * 3 + 1)
    expect(new Set(quota.requestedIdentities).size).toBe(1)
    expect(quota.requestedIdentities[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(quota.requestedIdentities[0]).not.toContain(CANONICAL_ACCESS_TOKEN)
  })

  it('enforces the hard limit under concurrent requests', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })
    const responses = await Promise.all(
      Array.from({ length: MODEL_MONTHLY_DOWNLOAD_LIMIT * 2 }, () =>
        fetchWorker(authorizedModelRequest(fixture, 'GET'), env),
      ),
    )

    expect(responses.filter(({ status }) => status === 200)).toHaveLength(MODEL_MONTHLY_DOWNLOAD_LIMIT)
    expect(responses.filter(({ status }) => status === 503)).toHaveLength(MODEL_MONTHLY_DOWNLOAD_LIMIT)
    await Promise.all(responses.map((response) => response.arrayBuffer()))
    for (const response of responses.filter(({ status }) => status === 200)) {
      await confirmDownloadedModel(fixture, env, response)
    }
    expect((await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)).status).toBe(429)
  })

  it('does not consume quota for HEAD, OPTIONS, decoy, or runtime requests', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })

    const nonConsumingResponses = await Promise.all([
      fetchWorker(authorizedModelRequest(fixture, 'HEAD'), env),
      fetchWorker(modelRequest(fixture, 'OPTIONS'), env),
      fetchWorker(modelRequest(fixture, 'GET'), env),
      fetchWorker(assetRequest(fixture.publicRuntimeWasmPath, 'GET'), env),
    ])
    await Promise.all(nonConsumingResponses.map((response) => response.arrayBuffer()))

    for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT; index += 1) {
      const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)
      expect(response.status).toBe(200)
      await response.arrayBuffer()
      await confirmDownloadedModel(fixture, env, response)
    }
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedIdentities).toHaveLength(
      MODEL_MONTHLY_DOWNLOAD_LIMIT * 3,
    )
  })

  it('keeps serving real-model metadata to HEAD after the quota is exhausted', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })

    for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT; index += 1) {
      const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)
      await response.arrayBuffer()
      await confirmDownloadedModel(fixture, env, response)
    }
    const bucket = env.MODEL_BUCKET as MockR2Bucket
    const readsBeforeExhaustedRequest = bucket.requestedKeys.length
    expect((await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)).status).toBe(429)
    expect(bucket.requestedKeys.length).toBe(readsBeforeExhaustedRequest)

    // HEAD is unmetered, so an exhausted Key still identifies itself as valid by
    // reporting the real object's size. Clients rely on this to verify a Key
    // without spending a download.
    const headResponse = await fetchWorker(authorizedModelRequest(fixture, 'HEAD'), env)

    expect(headResponse.status).toBe(200)
    expect(headResponse.headers.get('content-length')).toBe(String(MODEL_INTEGRITY.byteLength))
    expect(headResponse.headers.get('retry-after')).toBeNull()
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedIdentities).toHaveLength(
      MODEL_MONTHLY_DOWNLOAD_LIMIT * 3 + 1,
    )
  })

  it('distinguishes a valid Key from an invalid one by HEAD content-length alone', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })

    const [valid, invalid] = await Promise.all([
      fetchWorker(authorizedModelRequest(fixture, 'HEAD'), env),
      fetchWorker(
        assetRequest(fixture.publicModelPath, 'HEAD', { authorization: `Bearer ${fixture.mismatchedKey}` }),
        env,
      ),
    ])

    expect(valid.status).toBe(200)
    expect(invalid.status).toBe(200)
    expect(valid.headers.get('content-length')).toBe(String(MODEL_INTEGRITY.byteLength))
    expect(invalid.headers.get('content-length')).toBe(String(fixture.decoyBody.length))
    expect(valid.headers.get('content-length')).not.toBe(invalid.headers.get('content-length'))
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedIdentities).toEqual([])
  })

  it('resets quota when the UTC calendar month changes', async () => {
    const fixture = createModelFixture()
    let now = new Date('2026-08-31T23:59:00.000Z')
    const env = createEnv(fixture, {
      keyValues: new Map([[fixture.validKey, '1']]),
      quotaNow: () => now,
    })
    for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT; index += 1) {
      const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)
      await response.arrayBuffer()
      await confirmDownloadedModel(fixture, env, response)
    }
    expect((await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)).status).toBe(429)

    now = new Date('2026-09-01T00:00:00.000Z')
    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)
    expect(response.status).toBe(200)
    await response.arrayBuffer()
  })

  it('keeps separate keys on independent monthly quotas', async () => {
    const fixture = createModelFixture()
    const otherKey = 'fedcba9876543210'.repeat(4)
    const env = createEnv(fixture, {
      keyValues: new Map([
        [fixture.validKey, '1'],
        [otherKey, '1'],
      ]),
    })

    for (const key of [fixture.validKey, otherKey]) {
      for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT; index += 1) {
        const response = await fetchWorker(authorizedModelRequest(fixture, 'GET', key), env)
        await response.arrayBuffer()
        await confirmDownloadedModel(fixture, env, response, key)
      }
      expect((await fetchWorker(authorizedModelRequest(fixture, 'GET', key), env)).status).toBe(429)
    }
    expect(new Set((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedIdentities).size).toBe(2)
  })
})
