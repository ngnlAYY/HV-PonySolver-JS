import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OnnxWorkerClient } from '../../src/inference/onnx-worker-client'
import type { ModelCache } from '../../src/model/model-cache'
import type { StatusPanel } from '../../src/status-panel/status-panel-types'

class FailingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null

  postMessage(message: { requestId?: number }): void {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: 'error',
          requestId: message.requestId,
          message: 'init failed',
        },
      } as MessageEvent)
    })
  }

  terminate(): void {}
}

class SuccessfulWorker {
  static messages: Array<{ requestId?: number; type?: string; ortScriptUrl?: string; wasmPath?: string; imageBlob?: Blob }> = []
  static transfers: Transferable[][] = []
  static instances: SuccessfulWorker[] = []
  static autoRespond = true

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null

  constructor() {
    SuccessfulWorker.instances.push(this)
  }

  postMessage(message: { requestId?: number; type?: string; ortScriptUrl?: string; wasmPath?: string; imageBlob?: Blob }, transfer?: Transferable[]): void {
    SuccessfulWorker.messages.push(message)
    SuccessfulWorker.transfers.push(transfer ?? [])
    for (const item of transfer ?? []) {
      if (item instanceof ArrayBuffer) {
        structuredClone(item, { transfer: [item] })
      }
    }
    if (SuccessfulWorker.autoRespond) {
      queueMicrotask(() => this.respond(message.requestId))
    }
  }

  respond(requestId: number | undefined): void {
    const response = SuccessfulWorker.messages.find((message) => message.requestId === requestId)?.type === 'detect'
      ? { type: 'response', requestId, result: { success: true, ponies: ['TS'], confidences: { TS: 0.9 }, detections: [{ class_id: 0, confidence: 0.9 }] } }
      : { type: 'response', requestId }
    this.onmessage?.({
      data: response,
    } as MessageEvent)
  }

  terminate(): void {}
}

function createPanel(): StatusPanel {
  return {
    create: vi.fn(),
    destroy: vi.fn(),
    setStatus: vi.fn(),
    setSessionReady: vi.fn(),
    addSuccess: vi.fn(),
    addRandomFailure: vi.fn(),
    addError: vi.fn(),
  }
}

function stubWorker(worker: new (...args: unknown[]) => Worker): void {
  vi.stubGlobal('Worker', worker)
  URL.createObjectURL = vi.fn(() => 'blob:worker')
  URL.revokeObjectURL = vi.fn()
}

describe('OnnxWorkerClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    SuccessfulWorker.messages = []
    SuccessfulWorker.transfers = []
    SuccessfulWorker.instances = []
    SuccessfulWorker.autoRespond = true
    vi.stubGlobal('__HV_PONY_SOLVER_TEST_WORKER_SCRIPT__', 'self.onmessage = () => {}')
    stubWorker(FailingWorker as unknown as new (...args: unknown[]) => Worker)
  })

  it('does not cache a downloaded model when worker init fails', async () => {
    const modelBuffer = new ArrayBuffer(8)
    const modelCache = {
      getCached: vi.fn(async () => null),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createPanel())

    await expect(client.prepare()).rejects.toThrow('init failed')

    expect(modelCache.download).toHaveBeenCalledTimes(1)
    expect(modelCache.putCached).not.toHaveBeenCalled()
  })

  it('sends ortScriptUrl by default when worker init succeeds', async () => {
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
    const client = new OnnxWorkerClient(modelCache, createPanel())

    await client.prepare()

    expect(modelCache.download).toHaveBeenCalledTimes(1)
    expect(putCached).toHaveBeenCalledTimes(1)
    expect(SuccessfulWorker.messages[0]).toMatchObject({
      type: 'init',
      ortScriptUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js',
      wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/',
    })
  })

  it('omits ortScriptUrl when configured for bundled runtime', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => modelBuffer),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createPanel(), { bundledRuntimeSource: 'self.ort = {};' })

    await client.prepare()

    expect(SuccessfulWorker.messages[0]).toMatchObject({
      type: 'init',
      wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/',
    })
    expect(SuccessfulWorker.messages[0]?.ortScriptUrl).toBeUndefined()
  })

  it('sends image blobs to worker without copying them into array buffers', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => modelBuffer),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => undefined),
    } as unknown as ModelCache
    const client = new OnnxWorkerClient(modelCache, createPanel())
    const imageBlob = { arrayBuffer: vi.fn() } as unknown as Blob

    const result = await client.detect(imageBlob)

    const detectMessage = SuccessfulWorker.messages.find((message) => message.type === 'detect')
    const detectTransfer = SuccessfulWorker.transfers[SuccessfulWorker.messages.findIndex((message) => message.type === 'detect')]
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
    const client = new OnnxWorkerClient(modelCache, createPanel())

    const result = await client.detect({} as Blob)

    expect(result).toMatchObject({ success: true, ponies: ['TS'] })
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
    const client = new OnnxWorkerClient(modelCache, createPanel())
    const preparePromise = client.prepare()
    await vi.waitFor(() => expect(SuccessfulWorker.messages).toHaveLength(1))
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[0]?.requestId)
    await preparePromise

    const firstDetect = client.detect({} as Blob)
    const secondDetect = client.detect({} as Blob)
    await vi.waitFor(() => expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(1))
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[1]?.requestId)
    await firstDetect
    await vi.waitFor(() => expect(SuccessfulWorker.messages.filter((message) => message.type === 'detect')).toHaveLength(2))
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
    const panel = createPanel()
    const client = new OnnxWorkerClient(modelCache, panel)

    const preparePromise = client.prepare()
    await vi.waitFor(() => expect(SuccessfulWorker.messages).toHaveLength(1))
    client.destroy()
    SuccessfulWorker.instances[0]?.respond(SuccessfulWorker.messages[0]?.requestId)

    await expect(preparePromise).rejects.toThrow('Worker 已关闭')
    expect(modelCache.putCached).not.toHaveBeenCalled()
    expect(panel.setSessionReady).not.toHaveBeenCalled()
  })

  it('does not mark ready when destroyed while caching the downloaded model', async () => {
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
    let resolveCacheWrite: (() => void) | undefined
    const modelBuffer = new Uint8Array([1, 2, 3, 4]).buffer
    const modelCache = {
      getCached: vi.fn(async () => null),
      download: vi.fn(async () => modelBuffer),
      putCached: vi.fn(async () => new Promise<void>((resolve) => {
        resolveCacheWrite = resolve
      })),
    } as unknown as ModelCache
    const panel = createPanel()
    const client = new OnnxWorkerClient(modelCache, panel)

    const preparePromise = client.prepare()
    await vi.waitFor(() => expect(modelCache.putCached).toHaveBeenCalledTimes(1))
    client.destroy()
    resolveCacheWrite?.()

    await expect(preparePromise).rejects.toThrow('Worker 已关闭')
    expect(panel.setSessionReady).not.toHaveBeenCalled()
  })
})
