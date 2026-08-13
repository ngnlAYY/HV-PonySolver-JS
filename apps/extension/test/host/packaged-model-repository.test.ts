// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { OnnxWorkerClient } from '@hv-pony-solver/browser-core/inference/onnx-worker-client'

import { PackagedModelRepository } from '../../src/host/packaged-model-repository'
import { silentStatusSink } from '../../src/host/status-sink'

class SuccessfulInitWorker {
  static messages: Array<Record<string, unknown>> = []
  static transfers: Transferable[][] = []
  static terminateCount = 0

  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null

  postMessage(message: Record<string, unknown>, transfer: Transferable[] = []): void {
    SuccessfulInitWorker.messages.push(message)
    SuccessfulInitWorker.transfers.push(transfer)
    queueMicrotask(() => {
      this.onmessage?.({
        data: { type: 'response', requestId: message.requestId },
      } as MessageEvent)
    })
  }

  terminate(): void {
    SuccessfulInitWorker.terminateCount += 1
  }
}

describe('PackagedModelRepository', () => {
  it('exposes only the installed asset as a cache hit', async () => {
    const model = Uint8Array.from([1, 2, 3]).buffer
    const loadModel = vi.fn(async () => model)
    const repository = new PackagedModelRepository(loadModel)

    await expect(repository.getCached()).resolves.toBe(model)
    await expect(repository.download()).rejects.toThrow('内置模型不允许远程下载')
    await expect(repository.putCached()).resolves.toBeUndefined()
    expect(loadModel).toHaveBeenCalledTimes(1)
  })

  it('transfers the local model once and never calls download or cache write', async () => {
    SuccessfulInitWorker.messages = []
    SuccessfulInitWorker.transfers = []
    SuccessfulInitWorker.terminateCount = 0
    const model = Uint8Array.from([1, 2, 3]).buffer
    const loadModel = vi.fn(async () => model)
    const repository = new PackagedModelRepository(loadModel)
    const download = vi.spyOn(repository, 'download')
    const putCached = vi.spyOn(repository, 'putCached')
    const workerFactory = vi.fn(() => new SuccessfulInitWorker() as unknown as Worker)
    const client = new OnnxWorkerClient(repository, silentStatusSink, workerFactory)

    await client.prepare()
    await client.prepare()

    expect(loadModel).toHaveBeenCalledTimes(1)
    expect(download).not.toHaveBeenCalled()
    expect(putCached).not.toHaveBeenCalled()
    expect(workerFactory).toHaveBeenCalledTimes(1)
    expect(SuccessfulInitWorker.messages).toEqual([
      expect.objectContaining({ type: 'init', modelBuffer: model }),
    ])
    expect(SuccessfulInitWorker.transfers).toEqual([[model]])

    client.destroy()
    expect(SuccessfulInitWorker.terminateCount).toBe(1)
  })

  it('can retry a failed local load and initialize a fresh client after teardown', async () => {
    SuccessfulInitWorker.messages = []
    SuccessfulInitWorker.transfers = []
    SuccessfulInitWorker.terminateCount = 0
    const firstModel = Uint8Array.from([1, 2, 3]).buffer
    const secondModel = Uint8Array.from([4, 5, 6]).buffer
    const loadModel = vi.fn()
      .mockRejectedValueOnce(new Error('扩展内置模型 完整性校验失败'))
      .mockResolvedValueOnce(firstModel)
      .mockResolvedValueOnce(secondModel)
    const repository = new PackagedModelRepository(loadModel)
    const workerFactory = vi.fn(() => new SuccessfulInitWorker() as unknown as Worker)
    const firstClient = new OnnxWorkerClient(repository, silentStatusSink, workerFactory)

    await expect(firstClient.prepare()).rejects.toThrow('扩展内置模型 完整性校验失败')
    expect(workerFactory).not.toHaveBeenCalled()
    await expect(firstClient.prepare()).resolves.toBeUndefined()
    firstClient.destroy()

    const freshClient = new OnnxWorkerClient(repository, silentStatusSink, workerFactory)
    await expect(freshClient.prepare()).resolves.toBeUndefined()
    freshClient.destroy()

    expect(loadModel).toHaveBeenCalledTimes(3)
    expect(workerFactory).toHaveBeenCalledTimes(2)
    expect(SuccessfulInitWorker.transfers).toEqual([[firstModel], [secondModel]])
  })

  it('does not create a Worker when destroyed during asset loading', async () => {
    let resolveModel: ((buffer: ArrayBuffer) => void) | undefined
    const loadModel = vi.fn(async () => new Promise<ArrayBuffer>((resolve) => {
      resolveModel = resolve
    }))
    const repository = new PackagedModelRepository(loadModel)
    const workerFactory = vi.fn(() => new SuccessfulInitWorker() as unknown as Worker)
    const client = new OnnxWorkerClient(repository, silentStatusSink, workerFactory)

    const preparePromise = client.prepare()
    await vi.waitFor(() => expect(loadModel).toHaveBeenCalledTimes(1))
    client.destroy()
    resolveModel?.(Uint8Array.from([1, 2, 3]).buffer)

    await expect(preparePromise).rejects.toThrow('Worker 已关闭')
    expect(workerFactory).not.toHaveBeenCalled()
  })
})
