import { afterEach, describe, expect, it, vi } from 'vitest'

import { imagePreprocessConfig } from '../../src/inference/inference-config'
import { startOnnxWorker } from '../../src/inference/onnx-worker-entry'

type WorkerHandler = ((event: MessageEvent) => void) | null

function installImageRuntime(): ReturnType<typeof vi.fn> {
  const close = vi.fn()
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 1, height: 1, close })),
  )
  class MockOffscreenCanvas {
    getContext(): object {
      return {
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({
          data: new Uint8ClampedArray(640 * 640 * 4),
        })),
      }
    }
  }
  vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas)
  return close
}

function createRuntime(sessionFactory: () => object): {
  runtime: never
  create: ReturnType<typeof vi.fn>
} {
  const create = vi.fn(async () => sessionFactory())
  class MockTensor {
    constructor(
      readonly type: string,
      readonly data: Float32Array,
      readonly dims: number[],
    ) {}
  }
  return {
    runtime: {
      InferenceSession: { create },
      Tensor: MockTensor,
    } as never,
    create,
  }
}

function sendWorkerRequest(data: object): void {
  const handler = (globalThis as typeof globalThis & { onmessage: WorkerHandler }).onmessage
  handler?.({ data } as MessageEvent)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('startOnnxWorker', () => {
  it('returns the initialized model buffer to the caller without copying it', async () => {
    const { runtime } = createRuntime(() => ({ run: vi.fn(), release: vi.fn(async () => undefined) }))
    const postMessage = vi.fn()
    vi.stubGlobal('postMessage', postMessage)
    startOnnxWorker(runtime, vi.fn())
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer

    sendWorkerRequest({ type: 'init', requestId: 1, modelBuffer })

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
    expect(postMessage).toHaveBeenCalledWith({ type: 'response', requestId: 1, modelBuffer }, [modelBuffer])
  })

  it('runs the first session-init settled hook once after a successful create', async () => {
    const { runtime, create } = createRuntime(() => ({ run: vi.fn(), release: vi.fn(async () => undefined) }))
    const postMessage = vi.fn()
    const onFirstSessionInitSettled = vi.fn()
    vi.stubGlobal('postMessage', postMessage)
    startOnnxWorker(runtime, vi.fn(), { onFirstSessionInitSettled })

    sendWorkerRequest({ type: 'init', requestId: 1, modelBuffer: new ArrayBuffer(4) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))

    expect(onFirstSessionInitSettled).toHaveBeenCalledTimes(1)
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(onFirstSessionInitSettled.mock.invocationCallOrder[0]!)
    expect(onFirstSessionInitSettled.mock.invocationCallOrder[0]).toBeLessThan(postMessage.mock.invocationCallOrder[0]!)

    sendWorkerRequest({ type: 'init', requestId: 2, modelBuffer: new ArrayBuffer(4) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2))

    expect(create).toHaveBeenCalledTimes(2)
    expect(onFirstSessionInitSettled).toHaveBeenCalledTimes(1)
  })

  it('runs the first session-init settled hook once when the first create rejects', async () => {
    const { runtime, create } = createRuntime(() => ({ run: vi.fn(), release: vi.fn(async () => undefined) }))
    create.mockRejectedValueOnce(new Error('session init failed'))
    const postMessage = vi.fn()
    const onFirstSessionInitSettled = vi.fn()
    vi.stubGlobal('postMessage', postMessage)
    startOnnxWorker(runtime, vi.fn(), { onFirstSessionInitSettled })

    sendWorkerRequest({ type: 'init', requestId: 1, modelBuffer: new ArrayBuffer(4) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'error',
      requestId: 1,
      message: 'session init failed',
    })
    expect(onFirstSessionInitSettled).toHaveBeenCalledTimes(1)

    sendWorkerRequest({ type: 'init', requestId: 2, modelBuffer: new ArrayBuffer(4) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2))

    expect(postMessage.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ type: 'response', requestId: 2 }))
    expect(create).toHaveBeenCalledTimes(2)
    expect(onFirstSessionInitSettled).toHaveBeenCalledTimes(1)
  })

  it('runs the first session-init settled hook once when async runtime initialization rejects', async () => {
    const { runtime, create } = createRuntime(() => ({ run: vi.fn(), release: vi.fn(async () => undefined) }))
    const initializeRuntime = vi.fn(async () => {
      throw new Error('runtime initialization failed')
    })
    const postMessage = vi.fn()
    const onFirstSessionInitSettled = vi.fn()
    vi.stubGlobal('postMessage', postMessage)
    startOnnxWorker(runtime, initializeRuntime, { onFirstSessionInitSettled })

    sendWorkerRequest({ type: 'init', requestId: 1, modelBuffer: new ArrayBuffer(4) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'error',
      requestId: 1,
      message: 'runtime initialization failed',
    })
    expect(initializeRuntime).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    expect(onFirstSessionInitSettled).toHaveBeenCalledTimes(1)

    sendWorkerRequest({ type: 'init', requestId: 2, modelBuffer: new ArrayBuffer(4) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2))
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'error',
      requestId: 2,
      message: 'runtime initialization failed',
    })
    expect(initializeRuntime).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    expect(onFirstSessionInitSettled).toHaveBeenCalledTimes(1)
  })

  it('serializes overlapping detects before reusing the shared input buffer', async () => {
    installImageRuntime()
    const runResolvers: Array<(outputs: object) => void> = []
    const run = vi.fn(
      () =>
        new Promise<object>((resolve) => {
          runResolvers.push(resolve)
        }),
    )
    const { runtime } = createRuntime(() => ({ run, release: vi.fn(async () => undefined) }))
    const postMessage = vi.fn()
    vi.stubGlobal('postMessage', postMessage)
    startOnnxWorker(runtime, vi.fn())

    sendWorkerRequest({ type: 'init', requestId: 1, modelBuffer: new ArrayBuffer(4) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
    sendWorkerRequest({ type: 'detect', requestId: 2, imageBlob: new Blob([new Uint8Array([0x00])]) })
    sendWorkerRequest({ type: 'detect', requestId: 3, imageBlob: new Blob([new Uint8Array([0x00])]) })
    await vi.waitFor(() => expect(run).toHaveBeenCalled())
    await Promise.resolve()
    await Promise.resolve()

    expect(run).toHaveBeenCalledTimes(1)
    runResolvers[0]?.({
      output0: { data: new Float32Array([0, 0, 0, 0, 0.95, 0]), dims: [1, 6] },
    })
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    runResolvers[1]?.({
      output0: { data: new Float32Array([0, 0, 0, 0, 0.95, 0]), dims: [1, 6] },
    })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(3))
  })

  it('rejects malformed requests before touching inference state', async () => {
    installImageRuntime()
    const run = vi.fn()
    const { runtime, create } = createRuntime(() => ({ run, release: vi.fn(async () => undefined) }))
    const postMessage = vi.fn()
    vi.stubGlobal('postMessage', postMessage)
    startOnnxWorker(runtime, vi.fn())

    sendWorkerRequest({ type: 'detect', requestId: 7 })

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
    expect(postMessage).toHaveBeenCalledWith({
      type: 'error',
      requestId: 7,
      message: 'ONNX Worker 请求格式无效',
    })
    expect(create).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled()
  })

  it('marks session.run failures fatal and releases the unusable session', async () => {
    installImageRuntime()
    const release = vi.fn(async () => undefined)
    const run = vi.fn(async () => {
      throw new Error('wasm trap')
    })
    const { runtime } = createRuntime(() => ({ run, release }))
    const postMessage = vi.fn()
    vi.stubGlobal('postMessage', postMessage)
    startOnnxWorker(runtime, vi.fn())

    sendWorkerRequest({ type: 'init', requestId: 1, modelBuffer: new ArrayBuffer(4) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
    sendWorkerRequest({ type: 'detect', requestId: 2, imageBlob: new Blob([new Uint8Array([0x00])]) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2))

    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'error',
        requestId: 2,
        fatal: true,
        message: expect.stringContaining('ONNX 推理执行失败'),
      }),
    )
    expect(release).toHaveBeenCalledTimes(1)

    sendWorkerRequest({ type: 'detect', requestId: 3, imageBlob: new Blob([new Uint8Array([0x00])]) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(3))
    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'error',
        requestId: 3,
        fatal: true,
        message: 'ONNX Worker 尚未初始化',
      }),
    )
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('treats malformed output tensors as fatal and releases the session', async () => {
    installImageRuntime()
    const release = vi.fn(async () => undefined)
    const run = vi.fn(async () => ({
      output0: {
        data: new Float32Array(5),
        dims: [1, 6],
      },
    }))
    const { runtime } = createRuntime(() => ({ run, release }))
    const postMessage = vi.fn()
    vi.stubGlobal('postMessage', postMessage)
    startOnnxWorker(runtime, vi.fn())

    sendWorkerRequest({ type: 'init', requestId: 1, modelBuffer: new ArrayBuffer(4) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
    sendWorkerRequest({ type: 'detect', requestId: 2, imageBlob: new Blob([new Uint8Array([0x00])]) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2))

    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'error',
        requestId: 2,
        fatal: true,
        message: expect.stringContaining('模型输出数据长度与维度不匹配'),
      }),
    )
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('runs an optional hook before detect without delaying initialization', async () => {
    installImageRuntime()
    const release = vi.fn(async () => undefined)
    const run = vi.fn(async () => ({
      output0: {
        data: new Float32Array([0, 0, 0, 0, 0.95, 0.95]),
        dims: [1, 6],
      },
    }))
    const { runtime } = createRuntime(() => ({ run, release }))
    const postMessage = vi.fn()
    const beforeDetect = vi.fn(async () => undefined)
    vi.stubGlobal('postMessage', postMessage)
    startOnnxWorker(runtime, vi.fn(), { beforeDetect })

    sendWorkerRequest({ type: 'init', requestId: 1, modelBuffer: new ArrayBuffer(4) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
    expect(beforeDetect).not.toHaveBeenCalled()

    sendWorkerRequest({ type: 'detect', requestId: 2, imageBlob: new Blob([new Uint8Array([0x00])]) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2))
    expect(beforeDetect).toHaveBeenCalledTimes(1)
    expect(beforeDetect.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]!)
  })

  it('rejects oversized encoded input before createImageBitmap', async () => {
    installImageRuntime()
    const release = vi.fn(async () => undefined)
    const run = vi.fn()
    const { runtime } = createRuntime(() => ({ run, release }))
    const postMessage = vi.fn()
    vi.stubGlobal('postMessage', postMessage)
    startOnnxWorker(runtime, vi.fn())

    sendWorkerRequest({ type: 'init', requestId: 1, modelBuffer: new ArrayBuffer(4) })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1))
    sendWorkerRequest({
      type: 'detect',
      requestId: 2,
      imageBlob: new Blob([new Uint8Array(imagePreprocessConfig.maxEncodedBytes + 1)]),
    })
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2))

    expect(postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'error',
        requestId: 2,
        message: expect.stringContaining('验证码图片数据超过限制'),
      }),
    )
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
  })
})
