import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { inferenceTimeoutConfig } from '../../src/inference/inference-config'
import { ONNX_RUNTIME_ASSETS } from '../../src/inference/onnx-runtime-assets'
import { OnnxWorkerClient } from '../../src/inference/onnx-worker-client'
import type { ModelCache } from '../../src/model/model-cache'
import { createMockPanel } from '../helpers/mock-panel'
import { FailingWorker, SuccessfulWorker, TimeoutThenSuccessfulWorker } from '../helpers/mock-worker'

function stubWorker(worker: new (...args: unknown[]) => Worker): void {
  vi.stubGlobal('Worker', worker)
  URL.createObjectURL = vi.fn(() => 'blob:worker')
  URL.revokeObjectURL = vi.fn()
}

describe('OnnxWorkerClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    SuccessfulWorker.reset()
    TimeoutThenSuccessfulWorker.reset()
    vi.stubGlobal('__HV_PONY_SOLVER_TEST_WORKER_SCRIPT__', 'self.onmessage = () => {}')
    stubWorker(FailingWorker as unknown as new (...args: unknown[]) => Worker)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not cache a downloaded model when worker init fails', async () => {
    const modelBuffer = new ArrayBuffer(8)
    const modelCache = {
      getCached: vi.fn(async () => null),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())

    await expect(client.prepare()).rejects.toThrow('init failed')

    expect(modelCache.download).toHaveBeenCalledTimes(1)
    expect(modelCache.putCached).not.toHaveBeenCalled()
  })

  it('sends a fixed init message shape when worker init succeeds', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const putCached = vi.fn(async (buffer: ArrayBuffer) => {
      expect(buffer.byteLength).toBe(4)
      expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3, 4])
    })
    const modelCache = {
      getCached: vi.fn(async () => null),
      download: vi.fn(async () => modelBuffer),
      putCached,
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())

    await client.prepare()

    expect(modelCache.download).toHaveBeenCalledTimes(1)
    expect(putCached).toHaveBeenCalledTimes(1)
    expect(putCached).toHaveBeenCalledWith(modelBuffer, true, true)
    expect(SuccessfulWorker.messages[0]).toMatchObject({
      type: 'init',
      wasmPath: ONNX_RUNTIME_ASSETS.cdn.wasmPath,
    })
    expect(SuccessfulWorker.messages[0]).not.toHaveProperty('ortScriptUrl')
  })

  it('keeps the init message URL-free with a bundled runtime', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => modelBuffer),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel(), { bundledRuntimeSource: 'self.ort = {};' })

    await client.prepare()

    expect(SuccessfulWorker.messages[0]).toMatchObject({
      type: 'init',
      wasmPath: ONNX_RUNTIME_ASSETS.cdn.wasmPath,
    })
    expect(SuccessfulWorker.messages[0]).not.toHaveProperty('ortScriptUrl')
  })

  it('sends image blobs to worker without copying them into array buffers', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => modelBuffer),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())
    const imageBlob = { arrayBuffer: vi.fn() } as unknown as Blob

    const result = await client.detect(imageBlob)

    const detectMessage = SuccessfulWorker.messages.find((message) => message.type === 'detect')
    const detectTransfer =
      SuccessfulWorker.transfers[SuccessfulWorker.messages.findIndex((message) => message.type === 'detect')]
    expect(detectMessage?.imageBlob).toBe(imageBlob)
    expect(detectTransfer).toEqual([])
    expect(imageBlob.arrayBuffer).not.toHaveBeenCalled()
    expect(result.ponies).toEqual(['TS'])
  })

  it('uses worker parsed results as detect output', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => modelBuffer),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())

    const result = await client.detect({} as Blob)

    expect(result).toMatchObject({ success: true, ponies: ['TS'] })
  })

  it('reports elapsed inference time when detect succeeds', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => modelBuffer),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const panel = createMockPanel()
    const client = new OnnxWorkerClient(modelCache, panel)

    await client.detect({} as Blob)

    expect(panel.setStatus).toHaveBeenCalledWith({ inference: '推理中' })
    expect(panel.setStatus).toHaveBeenCalledWith({ inference: expect.stringMatching(/^完成 \d+ms$/) })
  })

  it('reports session readiness after preparing without a transient overwritten status', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => modelBuffer),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const panel = createMockPanel()
    const client = new OnnxWorkerClient(modelCache, panel)

    await client.prepare()

    expect(panel.setStatus).toHaveBeenCalledWith({ session: '初始化中' })
    expect(panel.setStatus).not.toHaveBeenCalledWith({ session: expect.stringMatching(/^Worker 初始化 \d+ms$/) })
    expect(panel.setSessionReady).toHaveBeenCalledWith(expect.any(Number))
  })

  it('does not reset session readiness when prepare is called after ready', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => modelBuffer),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const panel = createMockPanel()
    const client = new OnnxWorkerClient(modelCache, panel)

    await client.prepare()
    await client.prepare()

    expect(panel.setSessionReady).toHaveBeenCalledTimes(1)
    expect(SuccessfulWorker.messages.filter((message) => message.type === 'init')).toHaveLength(1)
  })

  it('serializes overlapping detect requests', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    SuccessfulWorker.autoRespond = false
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => modelBuffer),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())
    const preparePromise = client.prepare()
    await vi.waitFor(() => expect(SuccessfulWorker.messages).toHaveLength(1))
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[0]?.requestId)
    await preparePromise

    const firstDetect = client.detect({} as Blob)
    const secondDetect = client.detect({} as Blob)
    await vi.waitFor(() =>
      expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(1),
    )
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[1]?.requestId)
    await firstDetect
    await vi.waitFor(() =>
      expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(2),
    )
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[2]?.requestId)

    await secondDetect
  })

  it('does not cache or mark ready when destroyed before worker init response', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    SuccessfulWorker.autoRespond = false
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => null),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const panel = createMockPanel()
    const client = new OnnxWorkerClient(modelCache, panel)

    const preparePromise = client.prepare()
    await vi.waitFor(() => expect(SuccessfulWorker.messages).toHaveLength(1))
    client.destroy()
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[0]?.requestId)

    await expect(preparePromise).rejects.toThrow('Worker 已关闭')
    expect(modelCache.putCached).not.toHaveBeenCalled()
    expect(panel.setSessionReady).not.toHaveBeenCalled()
    expect(SuccessfulWorker.terminateCount).toBeGreaterThanOrEqual(1)
  })

  it('does not mark ready when destroyed while caching the downloaded model', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    let resolveCacheWrite: (() => void) | undefined
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => null),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(
        async () =>
          new Promise<void>((resolve) => {
            resolveCacheWrite = resolve
          }),
      ),
    } as unknown as ModelCache
    const panel = createMockPanel()
    const client = new OnnxWorkerClient(modelCache, panel)

    const preparePromise = client.prepare()
    await vi.waitFor(() => expect(modelCache.putCached).toHaveBeenCalledTimes(1))
    client.destroy()
    resolveCacheWrite?.()

    await expect(preparePromise).rejects.toThrow('Worker 已关闭')
    expect(panel.setSessionReady).not.toHaveBeenCalled()
    expect(SuccessfulWorker.terminateCount).toBeGreaterThanOrEqual(1)
  })

  it('keeps initialized worker usable when caching the downloaded model fails', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => null),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => {
        throw new Error('cache failed')
      }),
    } as unknown as ModelCache
    const panel = createMockPanel()
    const client = new OnnxWorkerClient(modelCache, panel)

    const worker = await client.prepare()

    expect(worker).toBe(SuccessfulWorker.instances[0])
    expect(panel.setSessionReady).toHaveBeenCalledWith(expect.any(Number))
    expect(SuccessfulWorker.terminateCount).toBe(0)
    expect(modelCache.putCached).toHaveBeenCalledTimes(1)

    await expect(client.detect({} as Blob)).resolves.toMatchObject({ success: true, ponies: ['TS'] })
    expect(SuccessfulWorker.messages.filter((message) => message.type === 'init')).toHaveLength(1)
    expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(1)
  })

  it('marks session error, rejects pending init, and creates a new worker on next prepare after timeout', async () => {
    vi.useFakeTimers()
    stubWorker(TimeoutThenSuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelCache = {
      getCached: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      download: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const panel = createMockPanel()
    const client = new OnnxWorkerClient(modelCache, panel)

    const preparePromise = client.prepare()
    await vi.waitFor(() => expect(TimeoutThenSuccessfulWorker.messages).toHaveLength(1))
    vi.advanceTimersByTime(inferenceTimeoutConfig.workerInitTimeoutMs)

    await expect(preparePromise).rejects.toThrow('ONNX Worker 请求超时')
    expect(panel.setStatus).toHaveBeenCalledWith({ session: '错误' })

    const nextPreparePromise = client.prepare()
    await vi.waitFor(() => expect(SuccessfulWorker.messages).toHaveLength(1))
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[0]?.requestId)

    await expect(nextPreparePromise).resolves.toBe(SuccessfulWorker.instances[0])
    expect(TimeoutThenSuccessfulWorker.constructedCount).toBe(2)
  })

  it('ignores stale worker error events after a timed-out prepare is replaced', async () => {
    vi.useFakeTimers()
    stubWorker(TimeoutThenSuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelCache = {
      getCached: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      download: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const panel = createMockPanel()
    const client = new OnnxWorkerClient(modelCache, panel)

    const stalePreparePromise = client.prepare()
    await vi.waitFor(() => expect(TimeoutThenSuccessfulWorker.messages).toHaveLength(1))
    vi.advanceTimersByTime(inferenceTimeoutConfig.workerInitTimeoutMs)

    await expect(stalePreparePromise).rejects.toThrow('ONNX Worker 请求超时')

    const replacementPreparePromise = client.prepare()
    await vi.waitFor(() => expect(SuccessfulWorker.messages).toHaveLength(1))
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[0]?.requestId)

    await expect(replacementPreparePromise).resolves.toBe(SuccessfulWorker.instances[0])
    TimeoutThenSuccessfulWorker.instances[0]?.onerror?.({ error: new Error('stale worker failure') } as ErrorEvent)

    await expect(client.detect({} as Blob)).resolves.toMatchObject({ success: true, ponies: ['TS'] })
    expect(TimeoutThenSuccessfulWorker.constructedCount).toBe(2)
    expect(SuccessfulWorker.terminateCount).toBe(0)
    expect(SuccessfulWorker.messages.filter((message) => message.type === 'init')).toHaveLength(1)
    expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(1)
  })
})
