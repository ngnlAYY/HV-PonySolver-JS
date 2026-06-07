import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inferenceTimeoutConfig } from '../../src/inference/inference-config'
import { WorkerRequestBridge } from '../../src/inference/worker-request-bridge'

const detectResult = { success: false, ponies: [], confidences: {}, detections: [], candidates: [] }

class ManualWorker {
  messages: unknown[] = []
  transfers: Transferable[][] = []
  onmessage: ((event: MessageEvent) => void) | null = null

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.messages.push(message)
    this.transfers.push(transfer ?? [])
  }
}

describe('WorkerRequestBridge', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves the matching worker response', async () => {
    const worker = new ManualWorker()
    const bridge = new WorkerRequestBridge(worker as unknown as Worker, () => undefined)
    const promise = bridge.post({ type: 'init', wasmPath: '/wasm/', modelBuffer: new ArrayBuffer(1) }, [])

    worker.onmessage?.({ data: { type: 'response', requestId: 1 } } as MessageEvent)

    await expect(promise).resolves.toEqual({ type: 'response', requestId: 1 })
  })

  it('rejects error responses', async () => {
    const worker = new ManualWorker()
    const bridge = new WorkerRequestBridge(worker as unknown as Worker, () => undefined)
    const promise = bridge.post({ type: 'detect', imageBlob: new Blob(), size: 640 }, [])

    worker.onmessage?.({ data: { type: 'error', requestId: 1, message: 'bad output' } } as MessageEvent)

    await expect(promise).rejects.toThrow('bad output')
  })

  it('ignores unknown request ids', async () => {
    const worker = new ManualWorker()
    const bridge = new WorkerRequestBridge(worker as unknown as Worker, () => undefined)
    const promise = bridge.post({ type: 'detect', imageBlob: new Blob(), size: 640 }, [])

    worker.onmessage?.({ data: { type: 'response', requestId: 999 } } as MessageEvent)
    worker.onmessage?.({ data: { type: 'response', requestId: 1, result: detectResult } } as MessageEvent)

    await expect(promise).resolves.toMatchObject({ requestId: 1 })
  })

  it('rejects init request and calls onFailure when init timeout fires', async () => {
    vi.useFakeTimers()
    const worker = new ManualWorker()
    const onFailure = vi.fn()
    const bridge = new WorkerRequestBridge(worker as unknown as Worker, onFailure)
    const promise = bridge.post({ type: 'init', wasmPath: '/wasm/', modelBuffer: new ArrayBuffer(1) }, [])

    vi.advanceTimersByTime(inferenceTimeoutConfig.workerInitTimeoutMs)

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'ONNX Worker 请求超时' }))
    await expect(promise).rejects.toThrow('ONNX Worker 请求超时')
  })

  it('ignores late response after detect timeout', async () => {
    vi.useFakeTimers()
    const worker = new ManualWorker()
    const onFailure = vi.fn()
    const bridge = new WorkerRequestBridge(worker as unknown as Worker, onFailure)
    const promise = bridge.post({ type: 'detect', imageBlob: new Blob(), size: 640 }, [])

    vi.advanceTimersByTime(inferenceTimeoutConfig.workerDetectTimeoutMs)
    worker.onmessage?.({ data: { type: 'response', requestId: 1, result: detectResult } } as MessageEvent)

    await expect(promise).rejects.toThrow('ONNX Worker 请求超时')
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('rejects all pending requests and ignores late responses after rejectPending', async () => {
    vi.useFakeTimers()
    const worker = new ManualWorker()
    const onFailure = vi.fn()
    const bridge = new WorkerRequestBridge(worker as unknown as Worker, onFailure)
    const firstPromise = bridge.post({ type: 'detect', imageBlob: new Blob(), size: 640 }, [])
    const secondPromise = bridge.post({ type: 'detect', imageBlob: new Blob(), size: 640 }, [])

    bridge.rejectPending(new Error('closed'))
    worker.onmessage?.({ data: { type: 'response', requestId: 1, result: detectResult } } as MessageEvent)
    worker.onmessage?.({ data: { type: 'response', requestId: 2, result: detectResult } } as MessageEvent)
    vi.advanceTimersByTime(inferenceTimeoutConfig.workerDetectTimeoutMs)

    await expect(firstPromise).rejects.toThrow('closed')
    await expect(secondPromise).rejects.toThrow('closed')
    expect(onFailure).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
