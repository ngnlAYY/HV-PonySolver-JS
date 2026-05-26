import { beforeEach, describe, expect, it, vi } from 'vitest'
import { inferenceConfig } from '../../src/inference/inference-config'
import { WorkerRequestBridge } from '../../src/inference/worker-request-bridge'

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
    worker.onmessage?.({ data: { type: 'response', requestId: 1, result: { success: false, ponies: [], confidences: {}, detections: [] } } } as MessageEvent)

    await expect(promise).resolves.toMatchObject({ requestId: 1 })
  })

  it('fails pending requests when timeout fires', async () => {
    vi.useFakeTimers()
    const worker = new ManualWorker()
    const onFailure = vi.fn()
    const bridge = new WorkerRequestBridge(worker as unknown as Worker, onFailure)
    const promise = bridge.post({ type: 'detect', imageBlob: new Blob(), size: 640 }, [])

    vi.advanceTimersByTime(inferenceConfig.workerDetectTimeoutMs)

    expect(onFailure).toHaveBeenCalled()
    await expect(promise).rejects.toThrow('ONNX Worker 请求超时')
  })

  it('rejects all pending requests', async () => {
    const worker = new ManualWorker()
    const bridge = new WorkerRequestBridge(worker as unknown as Worker, () => undefined)
    const promise = bridge.post({ type: 'detect', imageBlob: new Blob(), size: 640 }, [])

    bridge.rejectPending(new Error('closed'))

    await expect(promise).rejects.toThrow('closed')
  })
})
