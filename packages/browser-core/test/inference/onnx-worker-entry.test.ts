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
