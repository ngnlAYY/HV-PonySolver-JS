import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { inferenceRecoveryConfig, inferenceTimeoutConfig } from '../../src/inference/inference-config'
import { OnnxWorkerClient as CoreOnnxWorkerClient, type ModelRepository } from '../../src/inference/onnx-worker-client'
import type { ModelCache } from '../../src/model/model-cache'
import { downloadModel } from '../../src/model/model-downloader'
import type { InferenceStatusSink } from '../../src/status-panel/status-panel-types'
import { createMockPanel } from '../helpers/mock-panel'
import { FailingWorker, SuccessfulWorker, TimeoutThenSuccessfulWorker } from '../helpers/mock-worker'

function stubWorker(worker: new (...args: unknown[]) => Worker): void {
  vi.stubGlobal('Worker', worker)
  URL.createObjectURL = vi.fn(() => 'blob:worker')
  URL.revokeObjectURL = vi.fn()
}

class OnnxWorkerClient extends CoreOnnxWorkerClient {
  constructor(modelCache: ModelRepository, panel: InferenceStatusSink) {
    super(modelCache, panel, () => new Worker('test-worker.js'))
  }
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
    vi.unstubAllGlobals()
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

  it('initializes directly from an already-verified buffer without reading IndexedDB', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    let cachedBytes: number[] = []
    const modelCache = {
      getCached: vi.fn(),
      download: vi.fn(),
      putCached: vi.fn(async (buffer: ArrayBuffer) => {
        cachedBytes = [...new Uint8Array(buffer)]
      }),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())

    await client.prepareFromVerifiedModel(modelBuffer)

    expect(modelCache.getCached).not.toHaveBeenCalled()
    expect(modelCache.download).not.toHaveBeenCalled()
    expect(modelBuffer.byteLength).toBe(0)
    expect(cachedBytes).toEqual([1, 2, 3, 4])
    expect(modelCache.putCached).toHaveBeenCalledWith(expect.any(ArrayBuffer), true, true, expect.any(AbortSignal))
    expect(SuccessfulWorker.messages[0]).toMatchObject({ type: 'init' })
  })

  it('does not cache a verified buffer when direct session initialization fails', async () => {
    const modelCache = {
      getCached: vi.fn(),
      download: vi.fn(),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())

    await expect(client.prepareFromVerifiedModel(new ArrayBuffer(8))).rejects.toThrow('init failed')

    expect(modelCache.getCached).not.toHaveBeenCalled()
    expect(modelCache.download).not.toHaveBeenCalled()
    expect(modelCache.putCached).not.toHaveBeenCalled()
  })

  it('bounds best-effort cache persistence after direct session initialization', async () => {
    vi.useFakeTimers()
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelCache = {
      getCached: vi.fn(),
      download: vi.fn(),
      putCached: vi.fn(() => new Promise<void>(() => {})),
    } as unknown as ModelCache
    const panel = createMockPanel()
    const client = new OnnxWorkerClient(modelCache, panel)
    const preparePromise = client.prepareFromVerifiedModel(new Uint8Array([1, 2, 3, 4]).buffer)
    await vi.waitFor(() => expect(modelCache.putCached).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(inferenceTimeoutConfig.modelCacheTimeoutMs)

    await expect(preparePromise).resolves.toBeUndefined()
    expect(panel.setSessionReady).toHaveBeenCalledTimes(1)
  })

  it('hashes a downloaded model only once before direct verified-buffer preparation', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const digestBytes = Uint8Array.from(
      '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'
        .match(/../g)!
        .map((hex) => Number.parseInt(hex, 16)),
    )
    const digest = vi.fn(async () => digestBytes.buffer)
    vi.stubGlobal('crypto', { subtle: { digest } })
    const modelBuffer = await downloadModel(
      undefined,
      {
        integrity: {
          byteLength: 3,
          sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
        },
      },
      {
        fetchImpl: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
        getAccessKey: async () => '',
      },
    )
    const modelCache = {
      getCached: vi.fn(),
      download: vi.fn(),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())

    await client.prepareFromVerifiedModel(modelBuffer)

    expect(digest).toHaveBeenCalledTimes(1)
    expect(modelCache.putCached).toHaveBeenCalledWith(expect.any(ArrayBuffer), true, true, expect.any(AbortSignal))
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
    expect(putCached).toHaveBeenCalledWith(modelBuffer, true, true, expect.any(AbortSignal))
    expect(SuccessfulWorker.messages[0]).toMatchObject({ type: 'init', modelBuffer })
    expect(SuccessfulWorker.messages[0]).not.toHaveProperty('wasmPath')
    expect(SuccessfulWorker.messages[0]).not.toHaveProperty('ortScriptUrl')
  })

  it('keeps the init message runtime-profile independent', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => modelBuffer),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())

    await client.prepare()

    expect(SuccessfulWorker.messages[0]).toMatchObject({ type: 'init', modelBuffer })
    expect(SuccessfulWorker.messages[0]).not.toHaveProperty('wasmPath')
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
    expect(detectMessage).not.toHaveProperty('size')
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

  it('keeps shared initialization alive while at least one caller still owns it', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    let resolveCached!: (buffer: ArrayBuffer) => void
    let repositorySignal: AbortSignal | undefined
    const modelCache = {
      getCached: vi.fn((signal?: AbortSignal) => {
        repositorySignal = signal
        return new Promise<ArrayBuffer>((resolve) => {
          resolveCached = resolve
        })
      }),
      download: vi.fn(),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())
    const firstController = new AbortController()
    const secondController = new AbortController()

    const first = client.prepare(firstController.signal)
    const second = client.prepare(secondController.signal)
    await vi.waitFor(() => expect(modelCache.getCached).toHaveBeenCalledTimes(1))
    firstController.abort()

    await expect(first).rejects.toThrow('推理请求已取消')
    expect(repositorySignal?.aborted).toBe(false)
    resolveCached(new Uint8Array([1, 2, 3, 4]).buffer)
    await expect(second).resolves.toBeUndefined()
    expect(SuccessfulWorker.messages.filter((message) => message.type === 'init')).toHaveLength(1)
  })

  it('cancels uncooperative shared initialization after its last owner leaves and permits retry', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const repositorySignals: AbortSignal[] = []
    let callCount = 0
    const modelCache = {
      getCached: vi.fn((signal?: AbortSignal) => {
        if (signal) {
          repositorySignals.push(signal)
        }
        callCount += 1
        return callCount === 1
          ? new Promise<ArrayBuffer | null>(() => {})
          : Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer)
      }),
      download: vi.fn(),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())
    const controller = new AbortController()
    const abandoned = client.prepare(controller.signal)
    await vi.waitFor(() => expect(modelCache.getCached).toHaveBeenCalledTimes(1))

    controller.abort()

    await expect(abandoned).rejects.toThrow('推理请求已取消')
    expect(repositorySignals[0]?.aborted).toBe(true)
    await expect(client.prepare()).resolves.toBeUndefined()
    expect(modelCache.getCached).toHaveBeenCalledTimes(2)
  })

  it('bounds uncooperative shared initialization and permits a fresh retry', async () => {
    vi.useFakeTimers()
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    let callCount = 0
    const modelCache = {
      getCached: vi.fn(() => {
        callCount += 1
        return callCount === 1
          ? new Promise<ArrayBuffer | null>(() => {})
          : Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer)
      }),
      download: vi.fn(),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())
    const timedOut = client.prepare()
    const rejection = expect(timedOut).rejects.toThrow('ONNX Worker 初始化超时')
    await vi.waitFor(() => expect(modelCache.getCached).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(inferenceTimeoutConfig.workerPrepareTimeoutMs)

    await rejection
    await expect(client.prepare()).resolves.toBeUndefined()
    expect(modelCache.getCached).toHaveBeenCalledTimes(2)
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

  it('settles an aborted queued detect without posting it to the Worker', async () => {
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
    await vi.waitFor(() =>
      expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(1),
    )
    const controller = new AbortController()
    const queuedDetect = client.detect({} as Blob, controller.signal)
    controller.abort()

    await expect(queuedDetect).rejects.toThrow('推理请求已取消')
    expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(1)

    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[1]?.requestId)
    await firstDetect
    await Promise.resolve()
    expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(1)
  })

  it('keeps an aborted running detect pending until the Worker actually settles', async () => {
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

    const controller = new AbortController()
    const detectPromise = client.detect({} as Blob, controller.signal)
    await vi.waitFor(() =>
      expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(1),
    )
    let settled = false
    void detectPromise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    controller.abort()
    await Promise.resolve()
    expect(settled).toBe(false)

    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[1]?.requestId)
    await expect(detectPromise).rejects.toThrow('推理请求已取消')
    expect(settled).toBe(true)
  })

  it('terminates a Worker that does not settle within the running-abort grace period and recreates it', async () => {
    vi.useFakeTimers()
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    SuccessfulWorker.autoRespond = false
    const modelCache = {
      getCached: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      download: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())
    const preparePromise = client.prepare()
    await vi.waitFor(() => expect(SuccessfulWorker.messages).toHaveLength(1))
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[0]?.requestId)
    await preparePromise

    const controller = new AbortController()
    const detectPromise = client.detect({} as Blob, controller.signal)
    await vi.waitFor(() =>
      expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(1),
    )
    controller.abort()
    const rejection = expect(detectPromise).rejects.toThrow('推理请求已取消')

    await vi.advanceTimersByTimeAsync(inferenceTimeoutConfig.workerAbortGraceTimeoutMs)

    await rejection
    expect(SuccessfulWorker.terminateCount).toBe(1)
    SuccessfulWorker.autoRespond = true
    await expect(client.detect({} as Blob)).resolves.toMatchObject({ success: true, ponies: ['TS'] })
    expect(SuccessfulWorker.instances).toHaveLength(2)
  })

  it('rebuilds the Worker immediately after a fatal response', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    SuccessfulWorker.autoRespond = false
    const modelCache = {
      getCached: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      download: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())
    const preparePromise = client.prepare()
    await vi.waitFor(() => expect(SuccessfulWorker.messages).toHaveLength(1))
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[0]?.requestId)
    await preparePromise

    const failedDetect = client.detect({} as Blob)
    await vi.waitFor(() =>
      expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(1),
    )
    const detectRequest = SuccessfulWorker.messages.find((message) => message.type === 'detect')
    SuccessfulWorker.instances[0]?.onmessage?.({
      data: { type: 'error', requestId: detectRequest?.requestId, message: 'session run failed', fatal: true },
    } as MessageEvent)

    await expect(failedDetect).rejects.toThrow('session run failed')
    expect(SuccessfulWorker.terminateCount).toBe(1)
    SuccessfulWorker.autoRespond = true
    await expect(client.detect({} as Blob)).resolves.toMatchObject({ success: true, ponies: ['TS'] })
    expect(SuccessfulWorker.instances).toHaveLength(2)
  })

  it('rebuilds the Worker after repeated nonfatal inference errors', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    SuccessfulWorker.autoRespond = false
    const modelCache = {
      getCached: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      download: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createMockPanel())
    const preparePromise = client.prepare()
    await vi.waitFor(() => expect(SuccessfulWorker.messages).toHaveLength(1))
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[0]?.requestId)
    await preparePromise

    for (let index = 0; index < inferenceRecoveryConfig.maxConsecutiveWorkerErrors; index += 1) {
      const failedDetect = client.detect({} as Blob)
      await vi.waitFor(() =>
        expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(index + 1),
      )
      const detectMessages = SuccessfulWorker.messages.filter((message) => message.type === 'detect')
      SuccessfulWorker.instances[0]?.onmessage?.({
        data: { type: 'error', requestId: detectMessages[index]?.requestId, message: `detect failed ${index}` },
      } as MessageEvent)
      await expect(failedDetect).rejects.toThrow(`detect failed ${index}`)
    }

    expect(SuccessfulWorker.terminateCount).toBe(1)
    SuccessfulWorker.autoRespond = true
    await expect(client.detect({} as Blob)).resolves.toMatchObject({ success: true, ponies: ['TS'] })
    expect(SuccessfulWorker.instances).toHaveLength(2)
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

    await expect(client.prepare()).resolves.toBeUndefined()

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

    await expect(nextPreparePromise).resolves.toBeUndefined()
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

    await expect(replacementPreparePromise).resolves.toBeUndefined()
    TimeoutThenSuccessfulWorker.instances[0]?.onerror?.({ error: new Error('stale worker failure') } as ErrorEvent)

    await expect(client.detect({} as Blob)).resolves.toMatchObject({ success: true, ponies: ['TS'] })
    expect(TimeoutThenSuccessfulWorker.constructedCount).toBe(2)
    expect(SuccessfulWorker.terminateCount).toBe(0)
    expect(SuccessfulWorker.messages.filter((message) => message.type === 'init')).toHaveLength(1)
    expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(1)
  })
})
