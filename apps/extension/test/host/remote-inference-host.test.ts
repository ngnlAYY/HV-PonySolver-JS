import { describe, expect, it, vi } from 'vitest'

import type { ModelCache, OnnxWorkerClient } from '@hv-pony-solver/browser-core'
import { ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared'

import { IndexedDbStringStorage } from '../../src/host/indexeddb-string-storage'
import {
  createRemoteInferenceHost,
  createRemoteKeyVerifier,
  MODEL_ACCESS_KEY_STORAGE_KEY,
  type RemoteKeyVerifierDependencies,
} from '../../src/host/remote-inference-host'
import { PROTOCOL_VERSION } from '../../src/protocol/messages'

function dependencies(onStage?: (stage: 'probe' | 'storage') => void): RemoteKeyVerifierDependencies {
  return {
    probe: vi.fn(async () => {
      onStage?.('probe')
      return { valid: true, quotaExceededRetryAfterSeconds: null }
    }),
    set: vi.fn(async () => {
      onStage?.('storage')
    }),
  }
}

describe('createRemoteKeyVerifier', () => {
  it('persists the Key once a quota-free probe accepts it', async () => {
    const order: string[] = []
    const deps = dependencies((stage) => order.push(stage))
    const verifier = createRemoteKeyVerifier(deps)
    const controller = new AbortController()
    const candidateKey = 'a'.repeat(64)

    await expect(verifier(`  ${candidateKey}  `, controller.signal)).resolves.toBeUndefined()

    expect(order).toEqual(['probe', 'storage'])
    expect(deps.probe).toHaveBeenCalledWith(controller.signal, candidateKey)
    expect(deps.set).toHaveBeenCalledWith(MODEL_ACCESS_KEY_STORAGE_KEY, candidateKey, controller.signal)
  })

  it('rejects a Key the probe reports as invalid without persisting it', async () => {
    const deps = dependencies()
    vi.mocked(deps.probe).mockResolvedValueOnce({ valid: false, quotaExceededRetryAfterSeconds: null })
    const verifier = createRemoteKeyVerifier(deps)

    await expect(verifier('d'.repeat(64), new AbortController().signal)).rejects.toThrow('模型 Key 无效')
    expect(deps.set).not.toHaveBeenCalled()
  })

  it('saves a valid Key and reports the notice when its monthly quota is already spent', async () => {
    const deps = dependencies()
    vi.mocked(deps.probe).mockResolvedValueOnce({ valid: true, quotaExceededRetryAfterSeconds: 852_747 })
    const verifier = createRemoteKeyVerifier(deps)
    const candidateKey = 'e'.repeat(64)

    await expect(verifier(candidateKey, new AbortController().signal)).resolves.toContain('额度已用完')
    expect(deps.set).toHaveBeenCalledWith(MODEL_ACCESS_KEY_STORAGE_KEY, candidateKey, expect.any(AbortSignal))
  })

  it.each([
    ['probe', []],
    ['storage', ['probe']],
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

describe('createRemoteInferenceHost', () => {
  it('wires quota-free Key probing, download, worker, Key storage, and terminal cleanup through the production factory', async () => {
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
    const requestedMethods: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        requestedMethods.push(method)
        if (method === 'HEAD') {
          // The probe must present the candidate Key, never the stored one.
          expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${'f'.repeat(64)}`)
          return new Response(null, { headers: { 'content-length': String(ORT_MODEL_INTEGRITY.byteLength) } })
        }
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

      const cacheDownload = vi.spyOn(modelCache, 'download')
      const cacheClose = vi.spyOn(modelCache, 'close').mockImplementation(() => undefined)
      const detectorDestroy = vi.spyOn(detector, 'destroy').mockImplementation(() => undefined)

      await expect(
        host.handle({
          protocol: PROTOCOL_VERSION,
          type: 'verify-key',
          requestId: 'factory-verify',
          candidateKey: `  ${'f'.repeat(64)}  `,
        }),
      ).resolves.toEqual({ protocol: PROTOCOL_VERSION, type: 'result', requestId: 'factory-verify', ok: true })
      // Verification must settle on the HEAD probe alone, never on a metered GET.
      expect(requestedMethods).toEqual(['GET', 'HEAD'])
      expect(cacheDownload).not.toHaveBeenCalled()
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
