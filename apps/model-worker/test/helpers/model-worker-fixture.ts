import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'

import worker, { type Env, type ModelBucket, type ModelKeyStore } from '../../src/index'

export type StoredObject = Readonly<{
  body: string
  etag?: string
  httpEtag?: string | null
}>

export type ModelFixture = Readonly<{
  publicModelPath: string
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
}>

export class MockKvNamespace implements ModelKeyStore {
  constructor(private readonly keyValues: ReadonlyMap<string, string> = new Map<string, string>()) {}

  async get(key: string): Promise<string | null> {
    return this.keyValues.get(key) ?? null
  }
}

export class MockR2Bucket implements ModelBucket {
  readonly requestedKeys: string[] = []

  constructor(private readonly objects: ReadonlyMap<string, StoredObject>) {}

  async get(key: string): Promise<R2ObjectBody | null> {
    this.requestedKeys.push(key)
    const object = this.objects.get(key)
    return object ? new MockR2ObjectBody(key, object) : null
  }
}

export class MockR2ObjectBody implements R2ObjectBody {
  readonly version = 'mock-version'
  readonly size: number
  readonly httpEtag: string
  readonly checksums: R2Checksums = { toJSON: () => ({}) }
  readonly uploaded = new Date('2026-05-18T00:00:00.000Z')
  readonly storageClass = 'Standard'
  readonly body: ReadableStream
  readonly bodyUsed = false

  constructor(
    readonly key: string,
    private readonly object: StoredObject,
  ) {
    this.size = object.body.length
    this.httpEtag = object.httpEtag === null ? '' : object.httpEtag ?? object.etag ?? '"mock-etag"'
    this.body = new Response(object.body).body ?? new ReadableStream()
  }

  get etag(): string {
    return this.httpEtag.replaceAll('"', '')
  }

  writeHttpMetadata(_headers: Headers): void {}
  async arrayBuffer(): Promise<ArrayBuffer> { return new TextEncoder().encode(this.object.body).slice().buffer }
  async bytes(): Promise<Uint8Array> { return new TextEncoder().encode(this.object.body) }
  async text(): Promise<string> { return this.object.body }
  async json<T>(): Promise<T> { return JSON.parse(this.object.body) as T }
  async blob(): Promise<Blob> { return new Blob([this.object.body]) }
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
  const objects = options.objects ?? new Map<string, StoredObject>([
    [fixture.realModelObjectKey, { body: fixture.realBody, etag: fixture.realEtag }],
    [fixture.realOrtModelObjectKey, { body: fixture.ortBody, etag: fixture.ortEtag }],
    [fixture.decoyModelObjectKey, { body: fixture.decoyBody, etag: fixture.decoyEtag }],
    [fixture.runtimeWasmObjectKey, { body: fixture.runtimeBody, etag: fixture.runtimeEtag }],
  ])
  const env: Env = {
    MODEL_KEYS: new MockKvNamespace(options.keyValues),
    MODEL_BUCKET: new MockR2Bucket(objects),
    PUBLIC_MODEL_PATH: fixture.publicModelPath,
    REAL_MODEL_OBJECT_KEY: fixture.realModelObjectKey,
    DECOY_MODEL_OBJECT_KEY: fixture.decoyModelObjectKey,
    PUBLIC_ORT_MODEL_PATH: fixture.publicOrtModelPath,
    REAL_ORT_MODEL_OBJECT_KEY: fixture.realOrtModelObjectKey,
    PUBLIC_RUNTIME_WASM_PATH: fixture.publicRuntimeWasmPath,
    RUNTIME_WASM_OBJECT_KEY: fixture.runtimeWasmObjectKey,
  }
  if (options.invalidKeyMode !== undefined) env.INVALID_KEY_MODE = options.invalidKeyMode
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
