import { describe, expect, it, vi } from 'vitest'

import {
  createRemoteKeyVerifier,
  MODEL_ACCESS_KEY_STORAGE_KEY,
  type RemoteKeyVerifierDependencies,
} from '../../src/host/remote-inference-host'

function dependencies(
  onStage?: (stage: 'download' | 'cache' | 'prepare' | 'storage') => void,
): RemoteKeyVerifierDependencies {
  const modelBuffer = new Uint8Array([1, 2, 3]).buffer
  return {
    download: vi.fn(async () => {
      onStage?.('download')
      return modelBuffer
    }),
    putCached: vi.fn(async () => {
      onStage?.('cache')
    }),
    prepare: vi.fn(async () => {
      onStage?.('prepare')
    }),
    set: vi.fn(async () => {
      onStage?.('storage')
    }),
  }
}

describe('createRemoteKeyVerifier', () => {
  it('orders download, cache, prepare, and persistence with one shared signal', async () => {
    const order: string[] = []
    const deps = dependencies((stage) => order.push(stage))
    const verifier = createRemoteKeyVerifier(deps)
    const controller = new AbortController()
    const candidateKey = 'a'.repeat(64)

    await verifier(candidateKey, controller.signal)

    expect(order).toEqual(['download', 'cache', 'prepare', 'storage'])
    expect(deps.download).toHaveBeenCalledWith(controller.signal, true, candidateKey)
    expect(deps.putCached).toHaveBeenCalledWith(expect.any(ArrayBuffer), true, false, controller.signal)
    expect(deps.prepare).toHaveBeenCalledWith(controller.signal)
    expect(deps.set).toHaveBeenCalledWith(
      MODEL_ACCESS_KEY_STORAGE_KEY,
      candidateKey,
      controller.signal,
    )
  })

  it.each([
    ['download', []],
    ['cache', ['download']],
    ['prepare', ['download', 'cache']],
    ['storage', ['download', 'cache', 'prepare']],
  ] as const)('stops after cancellation at the %s boundary', async (abortStage, completedBefore) => {
    const controller = new AbortController()
    const completed: string[] = []
    const deps = dependencies((stage) => {
      if (stage === abortStage) {
        controller.abort()
        return
      }
      completed.push(stage)
    })
    const verifier = createRemoteKeyVerifier(deps)

    await expect(verifier('b'.repeat(64), controller.signal)).rejects.toThrow('模型 Key 验证已取消')
    expect(completed).toEqual(completedBefore)
    if (abortStage !== 'storage') {
      expect(deps.set).not.toHaveBeenCalled()
    }
  })
})
