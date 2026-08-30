// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  loadWasm: vi.fn(),
  wasm: {} as Record<string, unknown>,
}))

const externalScriptUrl = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js'
const externalWasmBaseUrl = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'
const externalScriptBytes = new Uint8Array([1, 2, 3])
const externalScriptSha256 = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
const externalWasmUrl = `${externalWasmBaseUrl}ort-wasm-simd-threaded.jsep.wasm`
const externalWasmBytes = new Uint8Array([0, 97, 115, 109])
const externalWasmSha256 = 'cd5d4935a48c0672cb06407bb443bc0087aff947c6b864bac886982c73b3027f'

vi.mock('onnxruntime-web/wasm', () => ({
  env: { wasm: mocks.wasm },
  InferenceSession: { create: mocks.createSession },
  Tensor: class Tensor {
    constructor(
      readonly type: string,
      readonly data: Float32Array,
      readonly dims: number[],
    ) {}
  },
}))

vi.mock('../../src/inference/runtime-wasm-loader', () => ({
  loadVerifiedRuntimeWasm: mocks.loadWasm,
}))

describe('ONNX worker entry', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(mocks.wasm)) delete mocks.wasm[key]
    mocks.loadWasm.mockResolvedValue(new Uint8Array([0, 97, 115, 109]).buffer)
    mocks.createSession.mockResolvedValue({ run: vi.fn(), release: vi.fn() })
  })

  it('verifies WASM before creating an ORT-only single-thread session', async () => {
    const responses: unknown[] = []
    vi.stubGlobal('postMessage', (message: unknown) => responses.push(message))
    await import('../../src/inference/onnx-worker-bundled-entry')
    const modelBuffer = new Uint8Array([1, 2, 3]).buffer

    globalThis.onmessage?.({ data: { type: 'init', requestId: 7, modelBuffer } } as MessageEvent)

    await vi.waitFor(() => expect(responses).toContainEqual({ type: 'response', requestId: 7, modelBuffer }))
    expect(mocks.loadWasm).toHaveBeenCalledTimes(1)
    expect(mocks.wasm.numThreads).toBe(1)
    expect(mocks.wasm.proxy).toBe(false)
    expect(mocks.wasm.wasmBinary).toBeInstanceOf(ArrayBuffer)
    expect(mocks.createSession).toHaveBeenCalledWith(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'disabled',
    })
  })

  it('does not create a session when runtime integrity loading fails', async () => {
    const responses: unknown[] = []
    mocks.loadWasm.mockRejectedValueOnce(new Error('integrity failed'))
    vi.stubGlobal('postMessage', (message: unknown) => responses.push(message))
    await import('../../src/inference/onnx-worker-bundled-entry')

    globalThis.onmessage?.({
      data: { type: 'init', requestId: 8, modelBuffer: new ArrayBuffer(1) },
    } as MessageEvent)

    await vi.waitFor(() =>
      expect(responses).toContainEqual({ type: 'error', requestId: 8, message: 'integrity failed' }),
    )
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('verifies and executes the pinned external runtime while replaying its queued init', async () => {
    const responses: unknown[] = []
    const fetchResolvers: Array<(response: Response) => void> = []
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          fetchResolvers.push(resolve)
        }),
    )
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-ort')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const importScripts = vi.fn(() => {
      vi.stubGlobal('ort', {
        env: { wasm: mocks.wasm },
        InferenceSession: { create: mocks.createSession },
        Tensor: class Tensor {
          constructor(
            readonly type: string,
            readonly data: Float32Array,
            readonly dims: number[],
          ) {}
        },
      })
    })
    vi.stubGlobal('postMessage', (message: unknown) => responses.push(message))
    vi.stubGlobal('fetch', fetchImpl)
    vi.stubGlobal('importScripts', importScripts)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_URL__', externalScriptUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BASE_URL__', externalWasmBaseUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_BYTE_LENGTH__', externalScriptBytes.byteLength)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_SHA256__', externalScriptSha256)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_MAX_BYTE_LENGTH__', 4)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_URL__', externalWasmUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BYTE_LENGTH__', externalWasmBytes.byteLength)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_SHA256__', externalWasmSha256)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_MAX_BYTE_LENGTH__', 8)
    await import('../../src/inference/onnx-worker-external-entry')

    // The client can post immediately after constructing the Worker. The entry
    // must retain that transferable init until runtime verification completes.
    const modelBuffer = new ArrayBuffer(1)
    globalThis.onmessage?.({ data: { type: 'init', requestId: 9, modelBuffer } } as MessageEvent)
    expect(mocks.createSession).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(fetchResolvers).toHaveLength(2))
    fetchResolvers[0]?.(new Response(externalScriptBytes, { status: 200, headers: { 'content-length': '3' } }))
    fetchResolvers[1]?.(
      new Response(externalWasmBytes, {
        status: 200,
        headers: { 'content-length': String(externalWasmBytes.byteLength) },
      }),
    )

    await vi.waitFor(() => expect(responses).toContainEqual({ type: 'response', requestId: 9, modelBuffer }))
    expect(fetchImpl).toHaveBeenNthCalledWith(1, externalScriptUrl, {
      cache: 'force-cache',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(2, externalWasmUrl, {
      cache: 'force-cache',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    })
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(importScripts).toHaveBeenCalledWith('blob:verified-ort')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:verified-ort')
    expect(mocks.loadWasm).not.toHaveBeenCalled()
    expect(mocks.wasm.numThreads).toBe(1)
    expect(mocks.wasm.proxy).toBe(false)
    expect(mocks.wasm.wasmBinary).toBeInstanceOf(ArrayBuffer)
    expect(mocks.wasm.wasmPaths).toBeUndefined()
  })

  it('fails queued and future requests without executing integrity-mismatched runtime bytes', async () => {
    const responses: unknown[] = []
    let resolveScriptFetch: ((response: Response) => void) | undefined
    vi.stubGlobal('postMessage', (message: unknown) => responses.push(message))
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (String(input) === externalWasmUrl) {
          return Promise.resolve(new Response(externalWasmBytes, { status: 200 }))
        }
        return new Promise<Response>((resolve) => {
          resolveScriptFetch = resolve
        })
      }),
    )
    vi.stubGlobal('importScripts', vi.fn())
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_URL__', externalScriptUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BASE_URL__', externalWasmBaseUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_BYTE_LENGTH__', externalScriptBytes.byteLength)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_SHA256__', externalScriptSha256)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_MAX_BYTE_LENGTH__', 4)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_URL__', externalWasmUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BYTE_LENGTH__', externalWasmBytes.byteLength)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_SHA256__', externalWasmSha256)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_MAX_BYTE_LENGTH__', 8)
    await import('../../src/inference/onnx-worker-external-entry')
    globalThis.onmessage?.({
      data: { type: 'init', requestId: 10, modelBuffer: new ArrayBuffer(1) },
    } as MessageEvent)
    resolveScriptFetch?.(new Response(new Uint8Array([3, 2, 1]), { status: 200 }))

    await vi.waitFor(() =>
      expect(responses).toContainEqual({
        type: 'error',
        requestId: 10,
        message: 'ONNX Runtime 脚本 SHA-256 校验失败',
      }),
    )
    globalThis.onmessage?.({
      data: { type: 'init', requestId: 11, modelBuffer: new ArrayBuffer(1) },
    } as MessageEvent)
    await vi.waitFor(() =>
      expect(responses).toContainEqual({
        type: 'error',
        requestId: 11,
        message: 'ONNX Runtime 脚本 SHA-256 校验失败',
      }),
    )
    expect(globalThis.importScripts).not.toHaveBeenCalled()
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('does not let malformed startup messages consume the bounded request queue', async () => {
    const responses: unknown[] = []
    const fetchResolvers: Array<(response: Response) => void> = []
    vi.stubGlobal('postMessage', (message: unknown) => responses.push(message))
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            fetchResolvers.push(resolve)
          }),
      ),
    )
    vi.stubGlobal('importScripts', () => {
      vi.stubGlobal('ort', {
        env: { wasm: mocks.wasm },
        InferenceSession: { create: mocks.createSession },
        Tensor: class Tensor {},
      })
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified-ort')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_URL__', externalScriptUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BASE_URL__', externalWasmBaseUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_BYTE_LENGTH__', externalScriptBytes.byteLength)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_SHA256__', externalScriptSha256)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_MAX_BYTE_LENGTH__', 4)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_URL__', externalWasmUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BYTE_LENGTH__', externalWasmBytes.byteLength)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_SHA256__', externalWasmSha256)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_MAX_BYTE_LENGTH__', 8)
    await import('../../src/inference/onnx-worker-external-entry')

    globalThis.onmessage?.({ data: null } as MessageEvent)
    globalThis.onmessage?.({ data: { type: 'init' } } as MessageEvent)
    const modelBuffer = new ArrayBuffer(1)
    globalThis.onmessage?.({ data: { type: 'init', requestId: 12, modelBuffer } } as MessageEvent)
    await vi.waitFor(() => expect(fetchResolvers).toHaveLength(2))
    fetchResolvers[0]?.(new Response(externalScriptBytes, { status: 200 }))
    fetchResolvers[1]?.(new Response(externalWasmBytes, { status: 200 }))

    await vi.waitFor(() => expect(responses).toContainEqual({ type: 'response', requestId: 12, modelBuffer }))
  })

  it('aborts the peer runtime download when one external asset fails', async () => {
    const responses: unknown[] = []
    let wasmSignal: AbortSignal | null | undefined
    vi.stubGlobal('postMessage', (message: unknown) => responses.push(message))
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === externalScriptUrl) {
          return Promise.reject(new Error('script download failed'))
        }
        wasmSignal = init?.signal
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
      }),
    )
    vi.stubGlobal('importScripts', vi.fn())
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_URL__', externalScriptUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BASE_URL__', externalWasmBaseUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_BYTE_LENGTH__', externalScriptBytes.byteLength)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_SHA256__', externalScriptSha256)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_MAX_BYTE_LENGTH__', 4)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_URL__', externalWasmUrl)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BYTE_LENGTH__', externalWasmBytes.byteLength)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_SHA256__', externalWasmSha256)
    vi.stubGlobal('__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_MAX_BYTE_LENGTH__', 8)
    await import('../../src/inference/onnx-worker-external-entry')
    globalThis.onmessage?.({ data: { type: 'init', requestId: 13, modelBuffer: new ArrayBuffer(1) } } as MessageEvent)

    await vi.waitFor(() =>
      expect(responses).toContainEqual({ type: 'error', requestId: 13, message: 'script download failed' }),
    )
    expect(wasmSignal).toBeInstanceOf(AbortSignal)
    expect(wasmSignal?.aborted).toBe(true)
  })
})
