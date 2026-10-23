import { describe, expect, it, vi } from 'vitest'

import { ModelCache, type OnnxWorkerClient } from '@hv-pony-solver/browser-core'

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
  it('wires quota-free Key probing, quota query, download, worker, Key storage, and terminal cleanup through the production factory', async () => {
    const modelBuffer = new Uint8Array([1, 2, 3]).buffer
    const storageGet = vi.spyOn(IndexedDbStringStorage.prototype, 'get').mockResolvedValue('stored-key')
    const storageSet = vi.spyOn(IndexedDbStringStorage.prototype, 'set').mockResolvedValue()
    const storageRemove = vi.spyOn(IndexedDbStringStorage.prototype, 'remove').mockResolvedValue()
    const storageClose = vi.spyOn(IndexedDbStringStorage.prototype, 'close').mockResolvedValue()
    const workerArguments: unknown[][] = []
    let quotaResponse: {
      enabled: boolean
      limit: number
      used: number
      remaining: number | null
      retryAfterSeconds: number | null
    } = { enabled: true, limit: 5, used: 5, remaining: 0, retryAfterSeconds: 3600 }
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
    const requestedRoutes: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        const pathname = new URL(input.toString()).pathname
        requestedRoutes.push(`${method} ${pathname}`)
        if (pathname === '/quota') {
          expect(method).toBe('GET')
          const candidateProbe = requestedRoutes.length === 2
          expect(new Headers(init?.headers).get('authorization')).toBe(
            candidateProbe ? `Bearer ${'f'.repeat(64)}` : 'Bearer stored-key',
          )
          return Response.json(quotaResponse)
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
    try {
      await expect(modelCache.download(undefined, false)).resolves.toEqual(modelBuffer)
      expect(storageGet).toHaveBeenCalledWith(MODEL_ACCESS_KEY_STORAGE_KEY, expect.any(AbortSignal))

      expect(detectorInternals.workerFactory()).toBeInstanceOf(TestWorker)
      expect(workerArguments).toEqual([['moz-extension://test/runtime/inference-worker.js', { type: 'module' }]])

      const cacheGet = vi.spyOn(modelCache, 'getCached').mockResolvedValue(null)
      const cacheDownload = vi.spyOn(modelCache, 'download').mockResolvedValue(modelBuffer)
      const cachePut = vi.spyOn(modelCache, 'putCached').mockResolvedValue()
      const cacheClose = vi.spyOn(modelCache, 'close').mockImplementation(() => undefined)
      const detectorDestroy = vi.spyOn(detector, 'destroy').mockImplementation(() => undefined)

      await expect(
        host.handle({
          protocol: PROTOCOL_VERSION,
          type: 'verify-key',
          requestId: 'factory-verify',
          candidateKey: `  ${'f'.repeat(64)}  `,
        }),
      ).resolves.toEqual({
        protocol: PROTOCOL_VERSION,
        type: 'result',
        requestId: 'factory-verify',
        ok: true,
        notice: '模型 Key 有效并已安全保存；本月 5 次模型下载额度已用完，额度恢复后将自动下载模型',
      })
      // Verification must settle on quota JSON alone, never on a model request.
      expect(requestedRoutes).toEqual(['GET /yolo26n-640.ort', 'GET /quota'])
      expect(cacheDownload).not.toHaveBeenCalled()
      expect(storageSet).toHaveBeenCalledWith(
        MODEL_ACCESS_KEY_STORAGE_KEY,
        'f'.repeat(64),
        expect.any(AbortSignal),
        expect.any(Function),
      )

      await expect(
        host.handle({ protocol: PROTOCOL_VERSION, type: 'download-model', requestId: 'factory-download' }),
      ).resolves.toEqual({
        protocol: PROTOCOL_VERSION,
        type: 'result',
        requestId: 'factory-download',
        ok: true,
        notice: '模型下载和校验成功，已缓存',
      })
      expect(cacheGet).toHaveBeenCalledWith(expect.any(AbortSignal))
      expect(cacheDownload).toHaveBeenCalledWith(expect.any(AbortSignal))
      expect(cachePut).toHaveBeenCalledWith(modelBuffer, true, true, expect.any(AbortSignal))

      quotaResponse = { enabled: true, limit: 5, used: 2, remaining: 3, retryAfterSeconds: 3600 }
      await expect(
        host.handle({ protocol: PROTOCOL_VERSION, type: 'query-model-quota', requestId: 'factory-quota' }),
      ).resolves.toEqual({
        protocol: PROTOCOL_VERSION,
        type: 'result',
        requestId: 'factory-quota',
        ok: true,
        notice: '本月模型下载额度：已用 2/5 次，剩余 3 次',
      })

      quotaResponse = { enabled: false, limit: 0, used: 0, remaining: null, retryAfterSeconds: null }
      await expect(
        host.handle({ protocol: PROTOCOL_VERSION, type: 'query-model-quota', requestId: 'factory-quota-disabled' }),
      ).resolves.toEqual({
        protocol: PROTOCOL_VERSION,
        type: 'result',
        requestId: 'factory-quota-disabled',
        ok: true,
        notice: '无次数限制（模型下载次数限制未开启）',
      })

      await expect(
        host.handle({ protocol: PROTOCOL_VERSION, type: 'clear-key', requestId: 'factory-clear' }),
      ).resolves.toEqual({ protocol: PROTOCOL_VERSION, type: 'result', requestId: 'factory-clear', ok: true })
      expect(storageRemove).toHaveBeenCalledWith(
        MODEL_ACCESS_KEY_STORAGE_KEY,
        expect.any(AbortSignal),
        expect.any(Function),
      )

      host.destroy()
      expect(detectorDestroy).toHaveBeenCalledTimes(1)
      expect(cacheClose).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => expect(storageClose).toHaveBeenCalledTimes(1))
    } finally {
      host.destroy()
      vi.unstubAllGlobals()
    }
  })

  it.each(['query-model-quota', 'download-model', 'prepare'] as const)(
    'cancels the underlying Key read when %s is abandoned before any network request',
    async (type) => {
      let readCancelled = false
      const storageGet = vi.spyOn(IndexedDbStringStorage.prototype, 'get').mockImplementation((_key, signal) => {
        signal?.addEventListener(
          'abort',
          () => {
            readCancelled = true
          },
          { once: true },
        )
        // Keep the dependency pending: cancellation must settle without waiting for its acknowledgement.
        return Promise.race<string | null>([])
      })
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      const host = createRemoteInferenceHost()
      vi.spyOn(ModelCache.prototype, 'getCached').mockResolvedValue(null)
      const caller = new AbortController()
      try {
        const response = host.handle({ protocol: PROTOCOL_VERSION, type, requestId: 'cancel-key-read' }, caller.signal)
        await vi.waitFor(() => expect(storageGet).toHaveBeenCalledTimes(1))
        caller.abort()
        await expect(response).resolves.toMatchObject({ ok: false, error: expect.stringContaining('取消') })
        expect(readCancelled).toBe(true)
        expect(fetch).not.toHaveBeenCalled()
      } finally {
        host.destroy()
        vi.unstubAllGlobals()
      }
    },
  )
})
