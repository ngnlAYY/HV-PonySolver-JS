import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ONNX_RUNTIME_ASSETS } from '../../src/inference/onnx-runtime-assets'

type MockSession = Readonly<{
  run: ReturnType<typeof vi.fn>
}>

type MockOrt = Readonly<{
  env: { wasm: { wasmPaths?: string; numThreads?: number } }
  Tensor: typeof MockTensor
  InferenceSession: { create: ReturnType<typeof vi.fn> }
}>

type WorkerHarness = {
  worker: {
    ort?: MockOrt
    onmessage?: (event: MessageEvent) => Promise<void>
    postMessage: ReturnType<typeof vi.fn>
  }
  importScripts: ReturnType<typeof vi.fn>
}

class MockTensor {
  constructor(
    readonly type: string,
    readonly data: Float32Array,
    readonly dims: number[],
  ) {}
}

function createOrt(session: MockSession): MockOrt {
  return {
    env: { wasm: {} },
    Tensor: MockTensor,
    InferenceSession: {
      create: vi.fn(async () => session),
    },
  }
}

async function loadWorker(options: { ort?: MockOrt; runtimeSource?: string } = {}): Promise<WorkerHarness> {
  const worker: WorkerHarness['worker'] = {
    ort: options.ort,
    postMessage: vi.fn(),
  }
  const importScripts = vi.fn()
  vi.stubGlobal('self', worker)
  vi.stubGlobal('__HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE__', options.runtimeSource)
  vi.stubGlobal('importScripts', importScripts)

  await import('../../src/inference/onnx-worker-entry')
  expect(worker.onmessage).toEqual(expect.any(Function))
  return { worker, importScripts }
}

async function sendMessage(harness: WorkerHarness, data: unknown): Promise<void> {
  const onmessage = harness.worker.onmessage
  if (!onmessage) {
    throw new Error('worker message handler was not installed')
  }
  await onmessage({ data } as MessageEvent)
}

function yoloRow(confidence: number, classId: number): Float32Array {
  return new Float32Array([0, 0, 0, 0, confidence, classId])
}

describe('ONNX worker entry', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads the remote runtime and initializes one WASM session', async () => {
    const modelBuffer = new ArrayBuffer(3)
    const session = { run: vi.fn() }
    const ort = createOrt(session)
    const harness = await loadWorker()
    harness.importScripts.mockImplementation(() => {
      harness.worker.ort = ort
    })

    await sendMessage(harness, {
      type: 'init',
      requestId: 7,
      wasmPath: 'https://cdn.example/wasm/',
      modelBuffer,
    })
    await sendMessage(harness, {
      type: 'init',
      requestId: 8,
      wasmPath: 'https://cdn.example/wasm/',
      modelBuffer,
    })

    expect(harness.importScripts).toHaveBeenCalledTimes(1)
    expect(harness.importScripts).toHaveBeenCalledWith(ONNX_RUNTIME_ASSETS.cdn.scriptUrl)
    expect(ort.env.wasm).toEqual({ wasmPaths: 'https://cdn.example/wasm/', numThreads: 1 })
    expect(ort.InferenceSession.create).toHaveBeenCalledTimes(1)
    expect(ort.InferenceSession.create).toHaveBeenCalledWith(modelBuffer, { executionProviders: ['wasm'] })
    expect(harness.worker.postMessage).toHaveBeenNthCalledWith(1, { type: 'response', requestId: 7 })
    expect(harness.worker.postMessage).toHaveBeenNthCalledWith(2, { type: 'response', requestId: 8 })
  })

  it('uses a bundled runtime without importing a remote script', async () => {
    const session = { run: vi.fn() }
    const ort = createOrt(session)
    vi.stubGlobal('__HV_PONY_SOLVER_TEST_ORT__', ort)
    const harness = await loadWorker({
      runtimeSource: 'self.ort = globalThis.__HV_PONY_SOLVER_TEST_ORT__;',
    })

    await sendMessage(harness, {
      type: 'init',
      requestId: 11,
      wasmPath: '/ort/',
      modelBuffer: new ArrayBuffer(1),
    })

    expect(harness.importScripts).not.toHaveBeenCalled()
    expect(ort.InferenceSession.create).toHaveBeenCalledTimes(1)
    expect(harness.worker.postMessage).toHaveBeenCalledWith({ type: 'response', requestId: 11 })
  })

  it('reports canonical remote runtime loading failures through the worker protocol', async () => {
    const harness = await loadWorker()
    harness.importScripts.mockImplementation(() => {
      throw 'blocked by policy'
    })

    await sendMessage(harness, {
      type: 'init',
      requestId: 22,
      wasmPath: '/ort/',
      modelBuffer: new ArrayBuffer(1),
    })

    expect(harness.importScripts).toHaveBeenCalledWith(ONNX_RUNTIME_ASSETS.cdn.scriptUrl)
    expect(harness.worker.postMessage).toHaveBeenCalledWith({
      type: 'error',
      requestId: 22,
      message: 'onnxruntime-web 加载失败: blocked by policy',
    })
  })

  it('reports a remote script that does not install the runtime', async () => {
    const harness = await loadWorker()

    await sendMessage(harness, {
      type: 'init',
      requestId: 23,
      wasmPath: '/ort/',
      modelBuffer: new ArrayBuffer(1),
    })

    expect(harness.worker.postMessage).toHaveBeenCalledWith({
      type: 'error',
      requestId: 23,
      message: 'onnxruntime-web 未加载',
    })
  })

  it('preprocesses images, reuses same-size resources, and accepts both ONNX output shapes', async () => {
    const directOutput = yoloRow(0.8, 2)
    const wrappedOutput = new Float32Array([99, ...yoloRow(0.7, 3), 99])
    const session = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ output: { data: directOutput } })
        .mockResolvedValueOnce({
          output: {
            data: {
              buffer: wrappedOutput.buffer,
              byteOffset: Float32Array.BYTES_PER_ELEMENT,
              byteLength: yoloRow(0.7, 3).byteLength,
            },
          },
        }),
    }
    const ort = createOrt(session)
    const context = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([255, 128, 0, 255]) })),
    }
    const OffscreenCanvasMock = vi.fn(function MockOffscreenCanvas(this: { getContext: () => typeof context }) {
      this.getContext = () => context
    })
    const close = vi.fn()
    const createImageBitmap = vi.fn(async () => ({ width: 2, height: 1, close }))
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasMock)
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    const harness = await loadWorker({ ort })

    await sendMessage(harness, {
      type: 'init',
      requestId: 30,
      wasmPath: '/ort/',
      modelBuffer: new ArrayBuffer(1),
    })
    await sendMessage(harness, { type: 'detect', requestId: 31, imageBlob: new Blob(), size: 1 })
    await sendMessage(harness, { type: 'detect', requestId: 32, imageBlob: new Blob(), size: 1 })

    expect(OffscreenCanvasMock).toHaveBeenCalledTimes(1)
    expect(createImageBitmap).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1, 1)
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1, 1)
    expect(session.run).toHaveBeenCalledTimes(2)
    const firstTensor = session.run.mock.calls[0]?.[0].images as MockTensor
    expect(firstTensor).toEqual(
      expect.objectContaining({
        type: 'float32',
        dims: [1, 3, 1, 1],
      }),
    )
    expect(firstTensor.data[0]).toBe(1)
    expect(firstTensor.data[1]).toBeCloseTo(128 / 255)
    expect(firstTensor.data[2]).toBe(0)
    expect(harness.worker.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'response',
        requestId: 31,
        result: expect.objectContaining({ ponies: ['FS'] }),
      }),
    )
    expect(harness.worker.postMessage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'response',
        requestId: 32,
        result: expect.objectContaining({ ponies: ['RD'] }),
      }),
    )
  })

  it('reports detection before initialization and unknown message types', async () => {
    const harness = await loadWorker()

    await sendMessage(harness, { type: 'detect', requestId: 41, imageBlob: new Blob(), size: 1 })
    await sendMessage(harness, { type: 'unexpected', requestId: 42 })

    expect(harness.worker.postMessage).toHaveBeenNthCalledWith(1, {
      type: 'error',
      requestId: 41,
      message: 'ONNX Session 未初始化',
    })
    expect(harness.worker.postMessage).toHaveBeenNthCalledWith(2, {
      type: 'error',
      requestId: 42,
      message: '未知消息类型: unexpected',
    })
  })

  it('reports missing image preprocessing APIs after initialization', async () => {
    const session = { run: vi.fn() }
    const harness = await loadWorker({ ort: createOrt(session) })
    vi.stubGlobal('createImageBitmap', undefined)

    await sendMessage(harness, {
      type: 'init',
      requestId: 50,
      wasmPath: '/ort/',
      modelBuffer: new ArrayBuffer(1),
    })
    await sendMessage(harness, { type: 'detect', requestId: 51, imageBlob: new Blob(), size: 1 })

    expect(session.run).not.toHaveBeenCalled()
    expect(harness.worker.postMessage).toHaveBeenNthCalledWith(2, {
      type: 'error',
      requestId: 51,
      message: '当前环境不支持 createImageBitmap',
    })
  })
})
