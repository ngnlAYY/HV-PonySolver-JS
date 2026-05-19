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
  static messages: Array<{ type?: string; ortScriptUrl?: string; wasmPath?: string }> = []

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null

  postMessage(message: { requestId?: number; type?: string; ortScriptUrl?: string; wasmPath?: string }, transfer?: Transferable[]): void {
    SuccessfulWorker.messages.push(message)
    for (const item of transfer ?? []) {
      if (item instanceof ArrayBuffer) {
        structuredClone(item, { transfer: [item] })
      }
    }
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: 'response',
          requestId: message.requestId,
        },
      } as MessageEvent)
    })
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
})
