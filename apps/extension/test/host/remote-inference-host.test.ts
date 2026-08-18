import { describe, expect, it, vi } from 'vitest'

import type { ModelCache, OnnxWorkerClient } from '@hv-pony-solver/browser-core'

import { IndexedDbStringStorage } from '../../src/host/indexeddb-string-storage'
import {
  createRemoteInferenceHost,
  createRemoteKeyVerifier,
  MODEL_ACCESS_KEY_STORAGE_KEY,
  type RemoteKeyVerifierDependencies,
} from '../../src/host/remote-inference-host'
import { PROTOCOL_VERSION } from '../../src/protocol/messages'

function dependencies(
  onStage?: (stage: 'download' | 'prepare-verified' | 'storage') => void,
): RemoteKeyVerifierDependencies {
  const modelBuffer = new Uint8Array([1, 2, 3]).buffer
  return {
    download: vi.fn(async () => {
      onStage?.('download')
      return modelBuffer
    }),
    prepareFromVerifiedModel: vi.fn(async () => {
      onStage?.('prepare-verified')
    }),
    set: vi.fn(async () => {
      onStage?.('storage')
    }),
  }
}

describe('createRemoteKeyVerifier', () => {
  it('passes the once-verified download directly to verified-buffer preparation before persistence', async () => {
    const order: string[] = []
    const deps = dependencies((stage) => order.push(stage))
    const verifier = createRemoteKeyVerifier(deps)
    const controller = new AbortController()
    const candidateKey = 'a'.repeat(64)

    await verifier(`  ${candidateKey}  `, controller.signal)

    expect(order).toEqual(['download', 'prepare-verified', 'storage'])
    expect(deps.download).toHaveBeenCalledWith(controller.signal, true, candidateKey)
    const verifiedBuffer = await vi.mocked(deps.download).mock.results[0]!.value
    expect(deps.prepareFromVerifiedModel).toHaveBeenCalledWith(verifiedBuffer, controller.signal)
    expect(deps.set).toHaveBeenCalledWith(MODEL_ACCESS_KEY_STORAGE_KEY, candidateKey, controller.signal)
  })

  it.each([
    ['download', []],
    ['prepare-verified', ['download']],
    ['storage', ['download', 'prepare-verified']],
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

  it('persists a valid Key when verified-buffer preparation absorbs a cache write failure', async () => {
    const deps = dependencies()
    vi.mocked(deps.prepareFromVerifiedModel).mockImplementationOnce(async () => {
      try {
        await Promise.reject(new Error('IndexedDB cache failure'))
      } catch {
        // The verified-buffer API treats cache persistence as best-effort.
      }
    })
    const verifier = createRemoteKeyVerifier(deps)

    await expect(verifier('c'.repeat(64), new AbortController().signal)).resolves.toBeUndefined()
    expect(deps.set).toHaveBeenCalledTimes(1)
  })
})

describe('createRemoteInferenceHost', () => {
  it('wires verified download, worker, Key storage, and terminal cleanup through the production factory', async () => {
    const modelBuffer = new Uint8Array([1, 2, 3]).buffer
    const storageGet = vi.spyOn(IndexedDbStringStorage.prototype, 'get').mockResolvedValue('stored-key')
    const storageSet = vi.spyOn(IndexedDbStringStorage.prototype, 'set').mockResolvedValue()
    const storageRemove = vi.spyOn(IndexedDbStringStorage.prototype, 'remove').mockResolvedValue()
    const storageClose = vi.spyOn(IndexedDbStringStorage.prototype, 'close').mockResolvedValue()
    const workerArguments: unknown[][] = []
    class TestWorker {
      constructor(...args: unknown[]) {
        workerArguments.push(args)
      }
    }
    vi.stubGlobal('browser', {
      runtime: {
        getURL: (path: string) => `moz-extension://test/${path}`,
      },
    })
    vi.stubGlobal('Worker', TestWorker)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer stored-key')
        return new Response(new Uint8Array(modelBuffer))
      }),
    )

    const host = createRemoteInferenceHost()
    const detector = (host as unknown as { dependencies: { detector: OnnxWorkerClient } }).dependencies.detector
    const detectorInternals = detector as unknown as {
      modelCache: ModelCache
      workerFactory: () => Worker
    }
    const modelCache = detectorInternals.modelCache
    const cacheInternals = modelCache as unknown as {
      downloadModelImpl: (
        signal: AbortSignal | undefined,
        options: { integrity: { byteLength: number; sha256: string }; verifyIntegrity: boolean },
      ) => Promise<ArrayBuffer>
    }

    try {
      await expect(
        cacheInternals.downloadModelImpl(undefined, {
          integrity: { byteLength: modelBuffer.byteLength, sha256: 'unused-with-verification-disabled' },
          verifyIntegrity: false,
        }),
      ).resolves.toEqual(modelBuffer)
      expect(storageGet).toHaveBeenCalledWith(MODEL_ACCESS_KEY_STORAGE_KEY)

      expect(detectorInternals.workerFactory()).toBeInstanceOf(TestWorker)
      expect(workerArguments).toEqual([['moz-extension://test/inference-worker.js', { type: 'module' }]])

      const cacheDownload = vi.spyOn(modelCache, 'download').mockResolvedValue(modelBuffer)
      const prepareVerified = vi.spyOn(detector, 'prepareFromVerifiedModel').mockResolvedValue()
      const cacheClose = vi.spyOn(modelCache, 'close').mockImplementation(() => undefined)
      const detectorDestroy = vi.spyOn(detector, 'destroy').mockImplementation(() => undefined)

      await expect(
        host.handle({
          protocol: PROTOCOL_VERSION,
          type: 'verify-key',
          requestId: 'factory-verify',
          candidateKey: `  ${'f'.repeat(64)}  `,
        }),
      ).resolves.toMatchObject({ ok: true, requestId: 'factory-verify' })
      expect(cacheDownload).toHaveBeenCalledWith(expect.any(AbortSignal), true, 'f'.repeat(64))
      expect(prepareVerified).toHaveBeenCalledWith(modelBuffer, expect.any(AbortSignal))
      expect(storageSet).toHaveBeenCalledWith(MODEL_ACCESS_KEY_STORAGE_KEY, 'f'.repeat(64), expect.any(AbortSignal))

      await expect(
        host.handle({ protocol: PROTOCOL_VERSION, type: 'clear-key', requestId: 'factory-clear' }),
      ).resolves.toMatchObject({ ok: true, requestId: 'factory-clear' })
      expect(storageRemove).toHaveBeenCalledWith(MODEL_ACCESS_KEY_STORAGE_KEY, expect.any(AbortSignal))

      host.destroy()
      expect(detectorDestroy).toHaveBeenCalledTimes(1)
      expect(cacheClose).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => expect(storageClose).toHaveBeenCalledTimes(1))
    } finally {
      host.destroy()
      vi.unstubAllGlobals()
    }
  })
})
