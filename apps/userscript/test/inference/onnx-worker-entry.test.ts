// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  loadWasm: vi.fn(),
  wasm: {} as Record<string, unknown>,
}))

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

    await vi.waitFor(() => expect(responses).toContainEqual({ type: 'response', requestId: 7 }))
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

    await vi.waitFor(() => expect(responses).toContainEqual({ type: 'error', requestId: 8, message: 'integrity failed' }))
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('loads and configures the pinned external full runtime without a minimal WASM fetch', async () => {
    const responses: unknown[] = []
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
    vi.stubGlobal('importScripts', importScripts)
    vi.stubGlobal(
      '__HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_URL__',
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js',
    )
    vi.stubGlobal(
      '__HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BASE_URL__',
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
    )
    await import('../../src/inference/onnx-worker-external-entry')

    globalThis.onmessage?.({
      data: { type: 'init', requestId: 9, modelBuffer: new ArrayBuffer(1) },
    } as MessageEvent)

    await vi.waitFor(() => expect(responses).toContainEqual({ type: 'response', requestId: 9 }))
    expect(importScripts).toHaveBeenCalledWith('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js')
    expect(mocks.loadWasm).not.toHaveBeenCalled()
    expect(mocks.wasm.numThreads).toBe(1)
    expect(mocks.wasm.proxy).toBe(false)
    expect(mocks.wasm.wasmPaths).toBe('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/')
  })
})
