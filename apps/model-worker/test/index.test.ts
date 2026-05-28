/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, expect, it } from 'vitest'

import { textResponse } from '../src/model-response'
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

describe('model worker', () => {
  it('returns the real model for GET when authorized key exists in KV', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(modelRequest(fixture, 'GET', fixture.validKey), env)

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.realBody)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe('inline; filename="yolo26n-640.onnx"')
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(response.headers.get('etag')).toBe(fixture.realEtag)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-hv-model-access')).toBeNull()
  })

  it('returns the real model for HEAD when authorized key exists in KV', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(modelRequest(fixture, 'HEAD', fixture.validKey), env)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('etag')).toBe(fixture.realEtag)
  })

  it('allows model downloads without an Origin header', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(modelRequest(fixture, 'GET', fixture.validKey), env)

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('allows model downloads from hentaiverse origins', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })

    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.validKey, { origin: HENTAIVERSE_ORIGIN }),
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
      modelRequest(fixture, 'GET', fixture.validKey, { origin: ALT_HENTAIVERSE_ORIGIN }),
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
      modelRequest(fixture, 'GET', fixture.validKey, { origin: 'https://attacker.example' }),
      env,
    )
    const varyTokens = response.headers.get('vary')
      ?.split(',')
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0)

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(varyTokens).toContain('origin')
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

  it('uses the shared default model path when PUBLIC_MODEL_PATH is omitted', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })
    delete env.PUBLIC_MODEL_PATH

    const response = await fetchWorker(new Request(`https://models.example/yolo26n-640.onnx?key=${fixture.validKey}`), env)

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.realBody)
  })

  it('returns the decoy model when key is missing', async () => {
    const fixture = createModelFixture()

    const response = await fetchWorker(modelRequest(fixture, 'GET'), createEnv(fixture))

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
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

  it('returns the decoy model when requested key is not authorized', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.mismatchedKey),
      createEnv(fixture, { keyValues: new Map<string, string>([[fixture.validKey, '1']]) }),
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
  })

  it('returns 403 with CORS when authorized KV key is missing and INVALID_KEY_MODE is error', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.validKey),
      createEnv(fixture, { invalidKeyMode: 'error' }),
    )

    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-hv-model-access')).toBeNull()
    expect(await response.text()).toBe('Forbidden')
  })

  it('returns 403 without ACAO for untrusted origins when INVALID_KEY_MODE is error', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.validKey, { origin: 'https://attacker.example' }),
      createEnv(fixture, { invalidKeyMode: 'error' }),
    )
    const varyTokens = response.headers.get('vary')
      ?.split(',')
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0)

    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(varyTokens).toContain('origin')
    expect(await response.text()).toBe('Forbidden')
  })

  it('returns 403 when key format is invalid and INVALID_KEY_MODE is error', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.invalidKey),
      createEnv(fixture, { invalidKeyMode: 'error' }),
    )

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('returns 403 for unauthorized key when INVALID_KEY_MODE is error', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.mismatchedKey),
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
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })

  it('returns 500 text when the selected R2 object is missing', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      modelRequest(fixture, 'GET', fixture.validKey),
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

  it('returns 500 with CORS when required environment config is missing', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })
    env.REAL_MODEL_OBJECT_KEY = ''

    const response = await fetchWorker(modelRequest(fixture, 'GET', fixture.validKey), env)

    expect(response.status).toBe(500)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.text()).toBe('Internal Server Error')
  })
})
