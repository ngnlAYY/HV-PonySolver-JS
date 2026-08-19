/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, expect, it, vi } from 'vitest'

const modelAccessMocks = vi.hoisted(() => ({
  getCanonicalRequestAccessToken: vi.fn<(request: Request) => string | null>(),
}))

vi.mock(import('../src/model-access'), async (importOriginal) => {
  const modelAccess = await importOriginal()
  modelAccessMocks.getCanonicalRequestAccessToken.mockImplementation(modelAccess.getCanonicalRequestAccessToken)
  return {
    ...modelAccess,
    getCanonicalRequestAccessToken: modelAccessMocks.getCanonicalRequestAccessToken,
  }
})

import { MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

import { addCorsHeaders, modelObjectResponse, textResponse } from '../src/model-response'
import {
  assetRequest,
  createEnv,
  createModelFixture,
  fetchWorker,
  type MockModelDownloadQuotaNamespace,
  type MockKvNamespace,
  type MockR2Bucket,
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
    expect(await readResponseBody(response)).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toBe(fixture.realEtag)
    expect(response.headers.get('content-length')).toBe(String(fixture.realBody.length))
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

  it('returns public preflight headers for the runtime WASM route', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      assetRequest(fixture.publicRuntimeWasmPath, 'OPTIONS', { origin: 'https://unrelated.example' }),
      createEnv(fixture),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS')
    expect(response.headers.get('access-control-allow-headers')).toBe('Authorization')
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
    expect(await readResponseBody(headResponse)).toBe('')
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

  it('returns a generic 500 when real access has no canonical token', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })
    modelAccessMocks.getCanonicalRequestAccessToken.mockReturnValueOnce(null)

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)

    expect(response.status).toBe(500)
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

  it('serves the requested ORT model from its dedicated protected object key', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })
    const response = await fetchWorker(
      assetRequest(fixture.publicOrtModelPath, 'GET', { authorization: `Bearer ${fixture.validKey}` }),
      env,
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.ortBody)
    expect(response.headers.get('content-disposition')).toBe(
      `inline; filename="${fixture.publicOrtModelPath.split('/').at(-1)}"`,
    )
    expect((env.MODEL_BUCKET as unknown as { requestedKeys: string[] }).requestedKeys).toEqual([
      fixture.realOrtModelObjectKey,
    ])
  })

  it('uses the default ORT filename when the configured path ends with a slash', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })
    env.PUBLIC_ORT_MODEL_PATH = `${fixture.publicOrtModelPath}/`

    const response = await fetchWorker(
      assetRequest(env.PUBLIC_ORT_MODEL_PATH, 'GET', { authorization: `Bearer ${fixture.validKey}` }),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe('inline; filename="yolo26n-640.ort"')
  })

  it('keeps unauthorized ORT requests on the decoy path', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(assetRequest(fixture.publicOrtModelPath, 'GET'), createEnv(fixture))

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('serves the exact runtime WASM route publicly with immutable caching', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      assetRequest(fixture.publicRuntimeWasmPath, 'GET', { origin: 'https://unrelated.example' }),
      createEnv(fixture),
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.runtimeBody)
    expect(response.headers.get('content-type')).toBe('application/wasm')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('etag')).toBe(fixture.runtimeEtag)
  })

  it('returns a generic 500 when the runtime WASM object is missing', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      assetRequest(fixture.publicRuntimeWasmPath, 'GET'),
      createEnv(fixture, { objects: new Map() }),
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('Internal Server Error')
  })

  it('rejects a bodyless R2 metadata object for a GET response', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    const object = await env.MODEL_BUCKET.head(fixture.realModelObjectKey)

    expect(object).not.toBeNull()
    expect(() =>
      modelObjectResponse(assetRequest(fixture.publicModelPath, 'GET'), object!, 'yolo26n-640.onnx'),
    ).toThrow('R2 GET response is missing a body')
  })

  it('does not infer model format for unconfigured paths', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(assetRequest(`${fixture.publicOrtModelPath}.onnx`, 'GET'), createEnv(fixture))
    expect(response.status).toBe(404)
  })

  it('checks the canonical lowercase KV key before legacy case variants', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map([[CANONICAL_ACCESS_TOKEN, '1']]),
    })

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET', UPPERCASE_ACCESS_TOKEN), env)

    expect(response.status).toBe(200)
    expect((env.MODEL_KEYS as MockKvNamespace).requestedKeys).toEqual([CANONICAL_ACCESS_TOKEN])
  })

  it('uses metadata-only R2 access for ORT and runtime HEAD requests', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })
    const bucket = env.MODEL_BUCKET as MockR2Bucket

    const [ortResponse, runtimeResponse] = await Promise.all([
      fetchWorker(
        assetRequest(fixture.publicOrtModelPath, 'HEAD', { authorization: `Bearer ${fixture.validKey}` }),
        env,
      ),
      fetchWorker(assetRequest(fixture.publicRuntimeWasmPath, 'HEAD'), env),
    ])

    expect(ortResponse.status).toBe(200)
    expect(runtimeResponse.status).toBe(200)
    expect(await readResponseBody(ortResponse)).toBe('')
    expect(await readResponseBody(runtimeResponse)).toBe('')
    expect(bucket.requestedKeys).toEqual([])
    expect(bucket.headRequestedKeys).toEqual(
      expect.arrayContaining([fixture.realOrtModelObjectKey, fixture.runtimeWasmObjectKey]),
    )
  })

  it('converts KV and R2 failures into generic secret-free errors', async () => {
    const fixture = createModelFixture()
    const keyFailure = await fetchWorker(
      authorizedModelRequest(fixture, 'GET'),
      createEnv(fixture, { keyError: new Error(`KV failed for ${fixture.validKey}`) }),
    )
    const getFailure = await fetchWorker(
      modelRequest(fixture, 'GET'),
      createEnv(fixture, { bucketGetError: new Error(`R2 GET failed for ${fixture.decoyModelObjectKey}`) }),
    )
    const headFailure = await fetchWorker(
      assetRequest(fixture.publicRuntimeWasmPath, 'HEAD'),
      createEnv(fixture, { bucketHeadError: new Error(`R2 HEAD failed for ${fixture.runtimeWasmObjectKey}`) }),
    )

    for (const response of [keyFailure, getFailure, headFailure]) {
      expect(response.status).toBe(500)
      expect(await response.text()).toBe('Internal Server Error')
    }
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
    }

    const response = await fetchWorker(
      authorizedModelRequest(fixture, 'GET', CANONICAL_ACCESS_TOKEN, { origin }),
      env,
    )
    expect(response.status).toBe(429)
    expect(await response.text()).toBe('Monthly model download quota exceeded')
    expect(response.headers.get('retry-after')).toMatch(/^[1-9][0-9]*$/)
    expect(response.headers.get('access-control-expose-headers')).toBe('Retry-After')
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')

    const quota = env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace
    expect(quota.requestedIdentities).toHaveLength(MODEL_MONTHLY_DOWNLOAD_LIMIT + 1)
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
    expect(responses.filter(({ status }) => status === 429)).toHaveLength(MODEL_MONTHLY_DOWNLOAD_LIMIT)
    await Promise.all(responses.map((response) => response.arrayBuffer()))
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
    }
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedIdentities).toHaveLength(
      MODEL_MONTHLY_DOWNLOAD_LIMIT,
    )
  })

  it('resets quota when the UTC calendar month changes', async () => {
    const fixture = createModelFixture()
    let now = new Date('2026-08-31T23:59:00.000Z')
    const env = createEnv(fixture, {
      keyValues: new Map([[fixture.validKey, '1']]),
      quotaNow: () => now,
    })
    for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT; index += 1) {
      await (await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)).arrayBuffer()
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
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1'], [otherKey, '1']]) })

    for (const key of [fixture.validKey, otherKey]) {
      for (let index = 0; index < MODEL_MONTHLY_DOWNLOAD_LIMIT; index += 1) {
        await (await fetchWorker(authorizedModelRequest(fixture, 'GET', key), env)).arrayBuffer()
      }
      expect((await fetchWorker(authorizedModelRequest(fixture, 'GET', key), env)).status).toBe(429)
    }
    expect(new Set((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedIdentities).size).toBe(2)
  })

  it('returns a retryable 503 when quota storage fails', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      authorizedModelRequest(fixture, 'GET'),
      createEnv(fixture, {
        keyValues: new Map([[fixture.validKey, '1']]),
        quotaError: new Error(`quota failed for ${fixture.validKey}`),
      }),
    )

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('Service Unavailable')
  })

  it('keeps concurrent real, decoy, and public runtime requests isolated', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })

    const [realResponse, decoyResponse, runtimeResponse] = await Promise.all([
      fetchWorker(authorizedModelRequest(fixture, 'GET'), env),
      fetchWorker(modelRequest(fixture, 'GET'), env),
      fetchWorker(assetRequest(fixture.publicRuntimeWasmPath, 'GET'), env),
    ])

    await expect(readResponseBody(realResponse)).resolves.toBe(fixture.realBody)
    await expect(readResponseBody(decoyResponse)).resolves.toBe(fixture.decoyBody)
    await expect(readResponseBody(runtimeResponse)).resolves.toBe(fixture.runtimeBody)
  })
})
