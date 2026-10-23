import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OnnxWorkerClient } from '../../src/inference/onnx-worker-client'
import type { ModelCache } from '../../src/model/model-cache'
import { createMockPanel } from '../helpers/mock-panel'
import { SuccessfulWorker } from '../../../../test/support/mock-worker'

function stubWorker(worker: new (...args: unknown[]) => Worker): void {
  vi.stubGlobal('Worker', worker)
  URL.createObjectURL = vi.fn(() => 'blob:worker')
  URL.revokeObjectURL = vi.fn()
}

describe('OnnxWorkerClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    SuccessfulWorker.reset()
    vi.stubGlobal('__HV_PONY_SOLVER_WORKER_SCRIPT__', 'self.onmessage = () => {}')
    stubWorker(SuccessfulWorker as unknown as new (...args: unknown[]) => Worker)
  })

  it('initializes through the userscript blob worker factory and caches the model', async () => {
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

    expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(expect.any(Blob))
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:worker')
    expect(modelCache.download).toHaveBeenCalledTimes(1)
    expect(putCached).toHaveBeenCalledTimes(1)
    expect(putCached).toHaveBeenCalledWith(modelBuffer, true, false, expect.any(AbortSignal))
    expect(SuccessfulWorker.messages[0]).toMatchObject({ type: 'init', modelBuffer })
    expect(SuccessfulWorker.messages[0]).not.toHaveProperty('wasmPath')
    expect(SuccessfulWorker.messages[0]).not.toHaveProperty('ortScriptUrl')
    client.destroy()
  })
})
