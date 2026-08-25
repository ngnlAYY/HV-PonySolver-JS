import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'

import { MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

import worker, {
  type Env,
  type ModelBucket,
  type ModelDownloadQuotaNamespace,
  type ModelKeyStore,
} from '../../src/index'
import { secondsUntilNextUtcMonth, utcMonthKey } from '../../src/model-download-quota'

export type StoredObject = Readonly<{
  body: string
  etag?: string
  httpEtag?: string | null
}>

export type ModelFixture = Readonly<{
  publicModelPath: string
  publicQuotaPath: string
  publicOrtModelPath: string
  publicRuntimeWasmPath: string
  realModelObjectKey: string
  realOrtModelObjectKey: string
  decoyModelObjectKey: string
  runtimeWasmObjectKey: string
  validKey: string
  mismatchedKey: string
  invalidKey: string
  realBody: string
  ortBody: string
  decoyBody: string
  runtimeBody: string
  realEtag: string
  ortEtag: string
  decoyEtag: string
  runtimeEtag: string
}>

export type EnvOptions = Readonly<{
  keyValues?: ReadonlyMap<string, string>
  objects?: ReadonlyMap<string, StoredObject>
  invalidKeyMode?: string
  keyError?: Error
  bucketGetError?: Error
  bucketHeadError?: Error
  quotaError?: Error
  quotaNamespace?: ModelDownloadQuotaNamespace
  quotaNow?: () => Date
  quotaEnabled?: boolean
}>

export class MockKvNamespace implements ModelKeyStore {
  readonly requestedKeys: string[] = []

  constructor(
    private readonly keyValues: ReadonlyMap<string, string> = new Map<string, string>(),
    private readonly error?: Error,
  ) {}

  async get(key: string): Promise<string | null> {
    this.requestedKeys.push(key)
    if (this.error) throw this.error
    return this.keyValues.get(key) ?? null
  }
}

export class MockR2Bucket implements ModelBucket {
  readonly requestedKeys: string[] = []
  readonly headRequestedKeys: string[] = []

  constructor(
    private readonly objects: ReadonlyMap<string, StoredObject>,
    private readonly getError?: Error,
    private readonly headError?: Error,
  ) {}

  async get(key: string): Promise<R2ObjectBody | null> {
    this.requestedKeys.push(key)
    if (this.getError) throw this.getError
    const object = this.objects.get(key)
    return object ? new MockR2ObjectBody(key, object) : null
  }

  async head(key: string): Promise<R2Object | null> {
    this.headRequestedKeys.push(key)
    if (this.headError) throw this.headError
    const object = this.objects.get(key)
    return object ? new MockR2Object(key, object) : null
  }
}

export class MockModelDownloadQuotaNamespace implements ModelDownloadQuotaNamespace {
  readonly requestedIdentities: string[] = []
  private readonly usage = new Map<string, { month: string; used: number }>()

  constructor(
    private readonly error?: Error,
    private readonly now: () => Date = () => new Date(),
  ) {}

  idFromName(name: string): DurableObjectId {
    return { toString: () => name } as DurableObjectId
  }

  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> } {
    const identity = id.toString()
    return {
      fetch: async (request: Request): Promise<Response> => {
        this.requestedIdentities.push(identity)
        if (this.error) throw this.error
        if (request.method !== 'POST') return new Response('Not Found', { status: 404 })
        const now = this.now()
        const month = utcMonthKey(now)
        const stored = this.usage.get(identity)
        const used = stored?.month === month ? Math.min(stored.used, MODEL_MONTHLY_DOWNLOAD_LIMIT) : 0
        if (new URL(request.url).pathname === '/status') {
          return Response.json({
            limit: MODEL_MONTHLY_DOWNLOAD_LIMIT,
            used,
            remaining: MODEL_MONTHLY_DOWNLOAD_LIMIT - used,
            retryAfterSeconds: secondsUntilNextUtcMonth(now),
          })
        }
        if (new URL(request.url).pathname !== '/consume') return new Response('Not Found', { status: 404 })
        if (used >= MODEL_MONTHLY_DOWNLOAD_LIMIT) {
          return Response.json({ allowed: false, retryAfterSeconds: secondsUntilNextUtcMonth(now) })
        }
        this.usage.set(identity, { month, used: used + 1 })
        return Response.json({ allowed: true, retryAfterSeconds: secondsUntilNextUtcMonth(now) })
      },
    }
  }
}

export class MockR2Object implements R2Object {
  readonly version = 'mock-version'
  readonly size: number
  readonly httpEtag: string
  readonly checksums: R2Checksums = { toJSON: () => ({}) }
  readonly uploaded = new Date('2026-05-18T00:00:00.000Z')
  readonly storageClass = 'Standard'

  constructor(
    readonly key: string,
    protected readonly object: StoredObject,
  ) {
    this.size = object.body.length
    this.httpEtag = object.httpEtag === null ? '' : (object.httpEtag ?? object.etag ?? '"mock-etag"')
  }

  get etag(): string {
    return this.httpEtag.replaceAll('"', '')
  }

  writeHttpMetadata(_headers: Headers): void {}
}

export class MockR2ObjectBody extends MockR2Object implements R2ObjectBody {
  readonly body: ReadableStream
  readonly bodyUsed = false

  constructor(key: string, object: StoredObject) {
    super(key, object)
    this.body = new Response(object.body).body ?? new ReadableStream()
  }

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

export function randomText(prefix: string): string {
  return `${prefix}-${randomHex(8)}`
}

function randomDistinctKey(validKey: string): string {
  let key = randomHex(32)
  while (key === validKey) key = randomHex(32)
  return key
}

export function createModelFixture(): ModelFixture {
  const validKey = randomHex(32)
  const suffix = randomHex(8)
  return {
    publicModelPath: `/models/${suffix}.onnx`,
    publicQuotaPath: '/quota',
    publicOrtModelPath: `/models/${suffix}.ort`,
    publicRuntimeWasmPath: `/runtime/ort-wasm-${suffix}.wasm`,
    realModelObjectKey: `real/${suffix}.onnx`,
    realOrtModelObjectKey: `real/${suffix}.ort`,
    decoyModelObjectKey: `decoy/${suffix}.onnx`,
    runtimeWasmObjectKey: `runtime/ort-wasm-${suffix}.wasm`,
    validKey,
    mismatchedKey: randomDistinctKey(validKey),
    invalidKey: randomText('not-a-64-hex-key'),
    realBody: randomText('real-model-bytes'),
    ortBody: randomText('ort-model-bytes'),
    decoyBody: randomText('decoy-model-bytes'),
    runtimeBody: randomText('runtime-wasm-bytes'),
    realEtag: `"real-${randomHex(8)}"`,
    ortEtag: `"ort-${randomHex(8)}"`,
    decoyEtag: `"decoy-${randomHex(8)}"`,
    runtimeEtag: `"runtime-${randomHex(8)}"`,
  }
}

export function createEnv(fixture: ModelFixture, options: EnvOptions = {}): Env {
  const objects =
    options.objects ??
    new Map<string, StoredObject>([
      [fixture.realModelObjectKey, { body: fixture.realBody, etag: fixture.realEtag }],
      [fixture.realOrtModelObjectKey, { body: fixture.ortBody, etag: fixture.ortEtag }],
      [fixture.decoyModelObjectKey, { body: fixture.decoyBody, etag: fixture.decoyEtag }],
      [fixture.runtimeWasmObjectKey, { body: fixture.runtimeBody, etag: fixture.runtimeEtag }],
    ])
  const env: Env = {
    MODEL_KEYS: new MockKvNamespace(options.keyValues, options.keyError),
    MODEL_BUCKET: new MockR2Bucket(objects, options.bucketGetError, options.bucketHeadError),
    MODEL_DOWNLOAD_QUOTAS:
      options.quotaNamespace ?? new MockModelDownloadQuotaNamespace(options.quotaError, options.quotaNow),
    PUBLIC_MODEL_PATH: fixture.publicModelPath,
    PUBLIC_QUOTA_PATH: fixture.publicQuotaPath,
    REAL_MODEL_OBJECT_KEY: fixture.realModelObjectKey,
    DECOY_MODEL_OBJECT_KEY: fixture.decoyModelObjectKey,
    PUBLIC_ORT_MODEL_PATH: fixture.publicOrtModelPath,
    REAL_ORT_MODEL_OBJECT_KEY: fixture.realOrtModelObjectKey,
    PUBLIC_RUNTIME_WASM_PATH: fixture.publicRuntimeWasmPath,
    RUNTIME_WASM_OBJECT_KEY: fixture.runtimeWasmObjectKey,
  }
  if (options.invalidKeyMode !== undefined) env.INVALID_KEY_MODE = options.invalidKeyMode
  if (options.quotaEnabled !== undefined) env.MODEL_DOWNLOAD_QUOTA_ENABLED = String(options.quotaEnabled)
  return env
}

export async function fetchWorker(request: Request, env: Env): Promise<Response> {
  const ctx = createExecutionContext()
  const response = await worker.fetch(request, env, ctx)
  await waitOnExecutionContext(ctx)
  return response
}

export async function readResponseBody(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer())
}

export function assetRequest(path: string, method: string, headers?: HeadersInit): Request {
  return new Request(`https://models.example${path}`, headers === undefined ? { method } : { method, headers })
}

export function modelRequest(fixture: ModelFixture, method: string, key?: string, headers?: HeadersInit): Request {
  const url = new URL(`https://models.example${fixture.publicModelPath}`)
  if (key !== undefined) url.searchParams.set('key', key)
  const init: RequestInit = { method }
  if (headers !== undefined) init.headers = headers
  return new Request(url, init)
}

export function quotaRequest(fixture: ModelFixture, method: string, key?: string, headers?: HeadersInit): Request {
  const url = new URL(`https://models.example${fixture.publicQuotaPath}`)
  if (key !== undefined) url.searchParams.set('key', key)
  const init: RequestInit = { method }
  if (headers !== undefined) init.headers = headers
  return new Request(url, init)
}
