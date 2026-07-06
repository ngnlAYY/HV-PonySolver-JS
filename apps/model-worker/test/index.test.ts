/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, expect, it } from 'vitest'

import { addCorsHeaders, textResponse } from '../src/model-response'
import {
  createEnv,
  createModelFixture,
  fetchWorker,
  modelRequest,
  randomText,
  readResponseBody,
  type StoredObject,
} from './helpers/model-worker-fixture'

const HENTAIVERSE_ORIGIN = 'https://hentaiverse.org'
const ALT_HENTAIVERSE_ORIGIN = 'https://alt.hentaiverse.org'
const CANONICAL_ACCESS_TOKEN = '0123456789abcdef'.repeat(4)
const UPPERCASE_ACCESS_TOKEN = CANONICAL_ACCESS_TOKEN.toUpperCase()
const MIXED_CASE_ACCESS_TOKEN = '0123456789abcdefABCDEF0123456789'.repeat(2)

function expectVaryOrigin(headers: Headers): void {
  const varyTokens = headers
    .get('vary')
    ?.split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)

  expect(varyTokens).toContain('origin')
}

function authorizedModelRequest(
  fixture: ReturnType<typeof createModelFixture>,
  method: string,
  token: string = fixture.validKey,
  headers: Record<string, string> = {},
): Request {
  return modelRequest(fixture, method, undefined, {
    ...headers,
    authorization: `Bearer ${token}`,
  })
}

describe('model worker', () => {
  it('returns the decoy model for GET when a valid key is supplied only as query', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(modelRequest(fixture, 'GET', fixture.validKey), env)

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe('inline; filename="yolo26n-640.onnx"')
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
    expect(response.headers.get('content-disposition')).toBe('inline; filename="yolo26n-640.onnx"')
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
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toBe(fixture.realEtag)
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
    expectVaryOrigin(response.headers)
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

  it('uses the shared default model path when PUBLIC_MODEL_PATH is omitted', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })
    delete env.PUBLIC_MODEL_PATH

    const response = await fetchWorker(
      new Request('https://models.example/yolo26n-640.onnx', {
        headers: { authorization: `Bearer ${fixture.validKey}` },
      }),
      env,
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.realBody)
  })

  it('sets ETag from R2 httpEtag for GET and HEAD model responses', async () => {
    const fixture = createModelFixture()
    const storedEtag = 'stored-etag-that-must-not-be-used'
    const httpEtag = '"http-etag-that-must-be-used"'
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
      objects: new Map<string, StoredObject>([
        [fixture.realModelObjectKey, { body: fixture.realBody, etag: storedEtag, httpEtag }],
        [fixture.decoyModelObjectKey, { body: fixture.decoyBody, etag: fixture.decoyEtag }],
      ]),
    })

    const getResponse = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)
    const headResponse = await fetchWorker(authorizedModelRequest(fixture, 'HEAD'), env)

    expect(getResponse.status).toBe(200)
    expect(getResponse.headers.get('etag')).toBe(httpEtag)
    expect(getResponse.headers.get('etag')).not.toBe(storedEtag)
    expect(headResponse.status).toBe(200)
    expect(headResponse.headers.get('etag')).toBe(httpEtag)
    expect(headResponse.headers.get('etag')).not.toBe(storedEtag)
    expect(await headResponse.text()).toBe('')
  })

  it('omits ETag when the R2 object has no httpEtag', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      authorizedModelRequest(fixture, 'GET'),
      createEnv(fixture, {
        keyValues: new Map<string, string>([[fixture.validKey, '1']]),
        objects: new Map<string, StoredObject>([
          [fixture.realModelObjectKey, { body: fixture.realBody, httpEtag: null }],
          [fixture.decoyModelObjectKey, { body: fixture.decoyBody, etag: fixture.decoyEtag }],
        ]),
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBeNull()
  })

  it('returns the decoy model when key is missing', async () => {
    const fixture = createModelFixture()

    const response = await fetchWorker(modelRequest(fixture, 'GET'), createEnv(fixture))

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toBe(fixture.decoyEtag)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-hv-model-access')).toBeNull()
  })

  it('returns the decoy model when key format is invalid', async () => {
    const fixture = createModelFixture()

    const response = await fetchWorker(modelRequest(fixture, 'GET', fixture.invalidKey), createEnv(fixture))

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
  })

  it('returns the decoy model when authorized KV key is missing', async () => {
    const fixture = createModelFixture()

    const response = await fetchWorker(modelRequest(fixture, 'GET', fixture.validKey), createEnv(fixture))

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
  })

  it('returns the decoy model when Authorization Bearer KV key is missing', async () => {
    const fixture = createModelFixture()

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET', fixture.validKey), createEnv(fixture))

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
    expect(response.headers.get('etag')).toBe(fixture.decoyEtag)
    expect(response.headers.get('x-hv-model-access')).toBeNull()
  })

  it('returns the decoy model when requested key is not authorized', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.mismatchedKey),
      createEnv(fixture, { keyValues: new Map<string, string>([[fixture.validKey, '1']]) }),
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
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
    const response = await fetchWorker(
      modelRequest(fixture, 'GET'),
      createEnv(fixture, { invalidKeyMode: ' ERROR ' }),
    )

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('normalizes INVALID_KEY_MODE before selecting the decoy behavior', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'GET'),
      createEnv(fixture, { invalidKeyMode: ' DeCoY ' }),
    )

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

  it('returns 500 text when the selected R2 object is missing', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      authorizedModelRequest(fixture, 'GET'),
      createEnv(fixture, {
        keyValues: new Map<string, string>([[fixture.validKey, '1']]),
        objects: new Map<string, StoredObject>([
          [fixture.decoyModelObjectKey, { body: fixture.decoyBody }],
        ]),
      }),
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('Internal Server Error')
  })

  it('returns 500 instead of silently falling back when INVALID_KEY_MODE is unsupported', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'GET'),
      createEnv(fixture, { invalidKeyMode: 'allow' }),
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.text()).toBe('Internal Server Error')
  })

  it('returns 500 with CORS when required environment config is missing', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })
    env.REAL_MODEL_OBJECT_KEY = ''

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)

    expect(response.status).toBe(500)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.text()).toBe('Internal Server Error')
  })
})
