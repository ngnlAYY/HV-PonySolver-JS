/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, expect, it } from 'vitest'

import { modelObjectResponse } from '../src/model-response'
import {
  assetRequest,
  createEnv,
  createModelFixture,
  fetchWorker,
  type MockKvNamespace,
  type MockR2Bucket,
  modelRequest,
  readResponseBody,
  type StoredObject,
} from './helpers/model-worker-fixture'
import {
  CANONICAL_ACCESS_TOKEN,
  UPPERCASE_ACCESS_TOKEN,
  authorizedModelRequest,
} from './helpers/model-worker-test-support'

describe('model-runtime-assets', () => {
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

  it('derives the legacy model download filename from a custom public path', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })
    env.PUBLIC_MODEL_PATH = '/models/custom-legacy-name.onnx'

    const response = await fetchWorker(
      new Request('https://models.example/models/custom-legacy-name.onnx', {
        headers: { authorization: `Bearer ${fixture.validKey}` },
      }),
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe('inline; filename="custom-legacy-name.onnx"')
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

  it.each(['', '   '])('treats a %j KV marker as unauthorized', async (marker) => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      authorizedModelRequest(fixture, 'GET', fixture.validKey),
      createEnv(fixture, { keyValues: new Map<string, string>([[fixture.validKey, marker]]) }),
    )

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
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

  it('returns a generic 500 when runtime WASM metadata drifts', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      assetRequest(fixture.publicRuntimeWasmPath, 'GET'),
      createEnv(fixture, {
        objects: new Map([[fixture.runtimeWasmObjectKey, { body: fixture.runtimeBody, size: 1 }]]),
      }),
    )

    expect(response.status).toBe(500)
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
})
