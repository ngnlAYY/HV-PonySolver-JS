/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, expect, it } from 'vitest'

import { MODEL_DOWNLOAD_RECEIPT_HEADER, MODEL_INTEGRITY } from '@hv-pony-solver/shared'

import { addCorsHeaders, textResponse } from '../src/model-response'
import {
  assetRequest,
  createEnv,
  createModelFixture,
  fetchWorker,
  type MockR2Bucket,
  modelRequest,
  quotaRequest,
  randomText,
  readResponseBody,
} from './helpers/model-worker-fixture'
import {
  ALT_HENTAIVERSE_ORIGIN,
  CANONICAL_ACCESS_TOKEN,
  HENTAIVERSE_ORIGIN,
  MIXED_CASE_ACCESS_TOKEN,
  UPPERCASE_ACCESS_TOKEN,
  authorizedModelRequest,
  expectVaryOrigin,
} from './helpers/model-worker-test-support'

describe('http-cors', () => {
  it('returns the decoy model for GET when a valid key is supplied only as query', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(modelRequest(fixture, 'GET', fixture.validKey), env)

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe(
      `inline; filename="${fixture.publicModelPath.slice(fixture.publicModelPath.lastIndexOf('/') + 1)}"`,
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toBe(fixture.decoyEtag)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-hv-model-access')).toBeNull()
  })

  it('allows canonical lowercase tokens to read uppercase historical KV keys', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[UPPERCASE_ACCESS_TOKEN, '1']]),
    })

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET', CANONICAL_ACCESS_TOKEN), env)

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.realBody)
  })

  it('allows uppercase tokens to read lowercase canonical KV keys', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[CANONICAL_ACCESS_TOKEN, '1']]),
    })

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET', UPPERCASE_ACCESS_TOKEN), env)

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.realBody)
  })

  it('allows mixed-case tokens to read matching historical mixed-case KV keys', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[MIXED_CASE_ACCESS_TOKEN, '1']]),
    })

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET', MIXED_CASE_ACCESS_TOKEN), env)

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.realBody)
  })

  it('returns the real model for GET when Authorization Bearer token is valid', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(
      modelRequest(fixture, 'GET', undefined, { authorization: `Bearer ${fixture.validKey}` }),
      env,
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.realBody)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe(
      `inline; filename="${fixture.publicModelPath.slice(fixture.publicModelPath.lastIndexOf('/') + 1)}"`,
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toBe(fixture.realEtag)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-hv-model-access')).toBeNull()
  })

  it('allows Authorization Bearer tokens to read historical uppercase KV keys', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[UPPERCASE_ACCESS_TOKEN, '1']]),
    })

    const response = await fetchWorker(
      modelRequest(fixture, 'GET', undefined, { authorization: `Bearer ${CANONICAL_ACCESS_TOKEN}` }),
      env,
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.realBody)
  })

  it('allows uppercase Authorization Bearer tokens to read lowercase canonical KV keys', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[CANONICAL_ACCESS_TOKEN, '1']]),
    })

    const response = await fetchWorker(
      modelRequest(fixture, 'GET', undefined, { authorization: `bearer ${UPPERCASE_ACCESS_TOKEN}` }),
      env,
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.realBody)
  })

  it('prefers Authorization Bearer token over query key when both are present', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.mismatchedKey, { authorization: `Bearer ${fixture.validKey}` }),
      env,
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.realBody)
  })

  it('does not fall back to query key when Authorization header is invalid', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.validKey, { authorization: `Token ${fixture.validKey}` }),
      env,
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toBe(fixture.decoyEtag)
    expect(response.headers.get('x-hv-model-access')).toBeNull()
  })

  it('does not fall back to query key when Authorization Bearer KV key is missing', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.validKey, { authorization: `Bearer ${fixture.mismatchedKey}` }),
      env,
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toBe(fixture.decoyEtag)
    expect(response.headers.get('x-hv-model-access')).toBeNull()
  })

  it('returns 403 for invalid Authorization when INVALID_KEY_MODE is error', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      invalidKeyMode: 'error',
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.validKey, { authorization: `Token ${fixture.validKey}` }),
      env,
    )

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('returns the real model for HEAD when authorized key exists in KV', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(authorizedModelRequest(fixture, 'HEAD'), env)

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toBe(fixture.realEtag)
    expect(response.headers.get('content-length')).toBe(String(MODEL_INTEGRITY.byteLength))
    const bucket = env.MODEL_BUCKET as MockR2Bucket
    expect(bucket.requestedKeys).toEqual([])
    expect(bucket.headRequestedKeys).toEqual([fixture.realModelObjectKey])
  })

  it('allows model downloads without an Origin header', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expectVaryOrigin(response.headers)
  })

  it('allows model downloads from hentaiverse origins', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(
      authorizedModelRequest(fixture, 'GET', fixture.validKey, { origin: HENTAIVERSE_ORIGIN }),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(HENTAIVERSE_ORIGIN)
  })

  it('allows model downloads from alt hentaiverse origins', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(
      authorizedModelRequest(fixture, 'GET', fixture.validKey, { origin: ALT_HENTAIVERSE_ORIGIN }),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(ALT_HENTAIVERSE_ORIGIN)
  })

  it('does not set ACAO for unknown origins on model requests and keeps Vary: Origin', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(
      authorizedModelRequest(fixture, 'GET', fixture.validKey, { origin: 'https://attacker.example' }),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expectVaryOrigin(response.headers)
  })

  it('appends Origin to an existing Vary header for CORS text responses', async () => {
    const response = textResponse(
      new Request('https://models.example/yolo26n-640.onnx', {
        headers: { origin: 'https://attacker.example' },
      }),
      'Not Found',
      404,
      { vary: 'Accept-Encoding' },
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('vary')).toBe('Accept-Encoding, Origin')
  })

  it('sets Vary: Origin for text responses without an Origin header', async () => {
    const response = textResponse(new Request('https://models.example/yolo26n-640.onnx'), 'Not Found', 404)

    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expectVaryOrigin(response.headers)
  })

  it('returns CORS preflight headers for Authorization requests from allowed origins', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'OPTIONS', undefined, {
        origin: HENTAIVERSE_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      }),
      createEnv(fixture),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(HENTAIVERSE_ORIGIN)
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBe('Authorization')
    expect(response.headers.get('access-control-max-age')).toBe('86400')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('')
    expectVaryOrigin(response.headers)
  })

  it('returns preflight headers without ACAO for unknown origins', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'OPTIONS', undefined, {
        origin: 'https://attacker.example',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      }),
      createEnv(fixture),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBe('Authorization')
    expect(response.headers.get('access-control-max-age')).toBe('86400')
    expectVaryOrigin(response.headers)
  })

  it('returns quota-specific preflight methods and headers', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      quotaRequest(fixture, 'OPTIONS', undefined, {
        origin: HENTAIVERSE_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': `authorization, ${MODEL_DOWNLOAD_RECEIPT_HEADER}`,
      }),
      createEnv(fixture),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(HENTAIVERSE_ORIGIN)
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBe(`Authorization, ${MODEL_DOWNLOAD_RECEIPT_HEADER}`)
    expect(response.headers.get('access-control-max-age')).toBe('86400')
    expectVaryOrigin(response.headers)
  })

  it('returns public preflight headers for the runtime WASM route', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      assetRequest(fixture.publicRuntimeWasmPath, 'OPTIONS', { origin: 'https://unrelated.example' }),
      createEnv(fixture),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBeNull()
    expect(response.headers.get('access-control-max-age')).toBe('86400')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('')
  })

  it('does not append duplicate Origin to an existing Vary: Origin header', () => {
    const headers = addCorsHeaders(
      new Headers({ vary: 'Origin' }),
      new Request('https://models.example/yolo26n-640.onnx', {
        headers: { origin: HENTAIVERSE_ORIGIN },
      }),
    )

    expect(headers.get('vary')).toBe('Origin')
    expect(headers.get('access-control-allow-origin')).toBe(HENTAIVERSE_ORIGIN)
  })

  it('does not append duplicate Origin when existing Vary token is lowercase', () => {
    const headers = addCorsHeaders(
      new Headers({ vary: 'origin' }),
      new Request('https://models.example/yolo26n-640.onnx', {
        headers: { origin: HENTAIVERSE_ORIGIN },
      }),
    )

    expect(headers.get('vary')).toBe('origin')
    expect(headers.get('access-control-allow-origin')).toBe(HENTAIVERSE_ORIGIN)
  })

  it('keeps Vary: Origin without ACAO for unknown origins', () => {
    const headers = addCorsHeaders(
      new Headers(),
      new Request('https://models.example/yolo26n-640.onnx', {
        headers: { origin: 'https://attacker.example' },
      }),
    )

    expect(headers.get('vary')).toBe('Origin')
    expect(headers.get('access-control-allow-origin')).toBeNull()
  })

  it('returns 403 with CORS when a valid key is supplied only as query and INVALID_KEY_MODE is error', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.validKey),
      createEnv(fixture, {
        invalidKeyMode: 'error',
        keyValues: new Map<string, string>([[fixture.validKey, '1']]),
      }),
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-hv-model-access')).toBeNull()
    expect(await response.text()).toBe('Forbidden')
  })

  it('normalizes INVALID_KEY_MODE before selecting the error behavior', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(modelRequest(fixture, 'GET'), createEnv(fixture, { invalidKeyMode: ' ERROR ' }))

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('normalizes INVALID_KEY_MODE before selecting the decoy behavior', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(modelRequest(fixture, 'GET'), createEnv(fixture, { invalidKeyMode: ' DeCoY ' }))

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
  })

  it('returns 403 without ACAO for untrusted origins when INVALID_KEY_MODE is error', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'GET', undefined, { origin: 'https://attacker.example' }),
      createEnv(fixture, { invalidKeyMode: 'error' }),
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expectVaryOrigin(response.headers)
    expect(await response.text()).toBe('Forbidden')
  })

  it('returns 403 when Authorization token format is invalid and INVALID_KEY_MODE is error', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      authorizedModelRequest(fixture, 'GET', fixture.invalidKey),
      createEnv(fixture, { invalidKeyMode: 'error' }),
    )

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('returns 403 for unauthorized Authorization token when INVALID_KEY_MODE is error', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      authorizedModelRequest(fixture, 'GET', fixture.mismatchedKey),
      createEnv(fixture, {
        invalidKeyMode: 'error',
        keyValues: new Map<string, string>([[fixture.validKey, '1']]),
      }),
    )

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('returns 404 with CORS for non-model paths', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      new Request(`https://models.example/${randomText('other')}.onnx`),
      createEnv(fixture),
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('returns 405 with CORS and Allow header for methods other than GET and HEAD', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(modelRequest(fixture, 'POST', fixture.validKey), createEnv(fixture))

    expect(response.status).toBe(405)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })
})
