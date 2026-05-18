/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import worker, { type Env, type ModelBucket, type ModelKeyStore } from '../src/index'

type StoredObject = Readonly<{
  body: string
  etag?: string
}>

type ModelFixture = Readonly<{
  publicModelPath: string
  realModelObjectKey: string
  decoyModelObjectKey: string
  validKey: string
  mismatchedKey: string
  invalidKey: string
  realBody: string
  decoyBody: string
  realEtag: string
  decoyEtag: string
}>

type EnvOptions = Readonly<{
  keyValues?: ReadonlyMap<string, string>
  objects?: ReadonlyMap<string, StoredObject>
  invalidKeyMode?: string
}>

class MockKvNamespace implements ModelKeyStore {
  private readonly keyValues: ReadonlyMap<string, string>

  constructor(keyValues: ReadonlyMap<string, string> = new Map<string, string>()) {
    this.keyValues = keyValues
  }

  async get(key: string): Promise<string | null> {
    return this.keyValues.get(key) ?? null
  }
}

class MockR2Bucket implements ModelBucket {
  readonly requestedKeys: string[] = []
  private readonly objects: ReadonlyMap<string, StoredObject>

  constructor(objects: ReadonlyMap<string, StoredObject>) {
    this.objects = objects
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    this.requestedKeys.push(key)
    const object = this.objects.get(key)

    if (!object) {
      return null
    }

    return new MockR2ObjectBody(key, object)
  }
}

class MockR2ObjectBody implements R2ObjectBody {
  readonly version = 'mock-version'
  readonly size: number
  readonly httpEtag: string
  readonly checksums: R2Checksums = {
    toJSON: () => ({}),
  }
  readonly uploaded = new Date('2026-05-18T00:00:00.000Z')
  readonly storageClass = 'Standard'
  readonly body: ReadableStream
  readonly bodyUsed = false

  constructor(
    readonly key: string,
    private readonly object: StoredObject,
  ) {
    this.size = object.body.length
    this.httpEtag = object.etag ?? '"mock-etag"'
    this.body = new Response(object.body).body ?? new ReadableStream()
  }

  get etag(): string {
    return this.httpEtag.replaceAll('"', '')
  }

  writeHttpMetadata(_headers: Headers): void {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    return new TextEncoder().encode(this.object.body).slice().buffer
  }

  async bytes(): Promise<Uint8Array> {
    return new TextEncoder().encode(this.object.body)
  }

  async text(): Promise<string> {
    return this.object.body
  }

  async json<T>(): Promise<T> {
    return JSON.parse(this.object.body) as T
  }

  async blob(): Promise<Blob> {
    return new Blob([this.object.body])
  }
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomText(prefix: string): string {
  return `${prefix}-${randomHex(8)}`
}

function randomDistinctKey(validKey: string): string {
  let key = randomHex(32)

  while (key === validKey) {
    key = randomHex(32)
  }

  return key
}

function createModelFixture(): ModelFixture {
  const validKey = randomHex(32)

  return {
    publicModelPath: `/models/${randomHex(8)}.onnx`,
    realModelObjectKey: `real/${randomHex(8)}.onnx`,
    decoyModelObjectKey: `decoy/${randomHex(8)}.onnx`,
    validKey,
    mismatchedKey: randomDistinctKey(validKey),
    invalidKey: randomText('not-a-64-hex-key'),
    realBody: randomText('real-model-bytes'),
    decoyBody: randomText('decoy-model-bytes'),
    realEtag: `"real-${randomHex(8)}"`,
    decoyEtag: `"decoy-${randomHex(8)}"`,
  }
}

function createEnv(fixture: ModelFixture, options: EnvOptions = {}): Env {
  const objects = options.objects ?? new Map<string, StoredObject>([
    [fixture.realModelObjectKey, { body: fixture.realBody, etag: fixture.realEtag }],
    [fixture.decoyModelObjectKey, { body: fixture.decoyBody, etag: fixture.decoyEtag }],
  ])

  const env: Env = {
    MODEL_KEYS: new MockKvNamespace(options.keyValues),
    MODEL_BUCKET: new MockR2Bucket(objects),
    PUBLIC_MODEL_PATH: fixture.publicModelPath,
    REAL_MODEL_OBJECT_KEY: fixture.realModelObjectKey,
    DECOY_MODEL_OBJECT_KEY: fixture.decoyModelObjectKey,
  }

  if (options.invalidKeyMode !== undefined) {
    env.INVALID_KEY_MODE = options.invalidKeyMode
  }

  return env
}

async function fetchWorker(request: Request, env: Env): Promise<Response> {
  const ctx = createExecutionContext()
  const response = await worker.fetch(request, env, ctx)
  await waitOnExecutionContext(ctx)
  return response
}

async function readResponseBody(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer())
}

const HENTAIVERSE_ORIGIN = 'https://hentaiverse.org'
const ALT_HENTAIVERSE_ORIGIN = 'https://alt.hentaiverse.org'

function modelRequest(fixture: ModelFixture, method: string, key?: string, headers?: HeadersInit): Request {
  const url = new URL(`https://models.example${fixture.publicModelPath}`)
  if (key !== undefined) {
    url.searchParams.set('key', key)
  }
  const init: RequestInit = { method }
  if (headers !== undefined) {
    init.headers = headers
  }
  return new Request(url, init)
}

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
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
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
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('returns the decoy model when key is missing', async () => {
    const fixture = createModelFixture()

    const response = await fetchWorker(modelRequest(fixture, 'GET'), createEnv(fixture))

    expect(response.status).toBe(200)
    expect(await readResponseBody(response)).toBe(fixture.decoyBody)
    expect(response.headers.get('etag')).toBe(fixture.decoyEtag)
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
    expect(await response.text()).toBe('Model object is not configured')
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
