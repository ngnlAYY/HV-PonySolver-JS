import { afterEach, expect, it, vi } from 'vitest'

import { App } from '@hv-pony-solver/browser-core/app/app'
import type { ModelCache, OnnxWorkerClient, StatusPanelContract } from '@hv-pony-solver/browser-core'
import { ModelAccessKeyRejectedError } from '@hv-pony-solver/browser-core/model/model-download-error'
import { ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared'

import { RemoteDetectorClient } from '../../src/content/remote-detector-client'
import { IndexedDbStringStorage } from '../../src/host/indexeddb-string-storage'
import { createRemoteInferenceHost } from '../../src/host/remote-inference-host'
import { isHostRequest, PROTOCOL_VERSION } from '../../src/protocol/messages'
import { appendCaptcha } from '../../../../test/support/captcha-fixture'
import { SuccessfulWorker } from '../../../../test/support/mock-worker'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it.each(['verify-key', 'clear-key'] as const)(
  '%s retires every old-Key warmup before a later captcha prepares, while preserving a ready session',
  async (operation) => {
    document.body.replaceChildren()
    SuccessfulWorker.reset()
    vi.stubGlobal('Worker', SuccessfulWorker)
    vi.spyOn(IndexedDbStringStorage.prototype, 'set').mockResolvedValue()
    vi.spyOn(IndexedDbStringStorage.prototype, 'remove').mockResolvedValue()
    vi.spyOn(IndexedDbStringStorage.prototype, 'close').mockResolvedValue()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(null, {
            headers: { 'content-length': String(ORT_MODEL_INTEGRITY.byteLength) },
          }),
      ),
    )

    const host = createRemoteInferenceHost()
    const detector = (host as unknown as { dependencies: { detector: OnnxWorkerClient } }).dependencies.detector
    const prepare = vi.spyOn(detector, 'prepare')
    const cache = (detector as unknown as { modelCache: ModelCache }).modelCache
    vi.spyOn(cache, 'getCached').mockResolvedValue(null)
    vi.spyOn(cache, 'putCached').mockResolvedValue()
    let oldSignal: AbortSignal | undefined
    let rejectOld!: (error: Error) => void
    const download = vi
      .spyOn(cache, 'download')
      .mockImplementationOnce((signal) => {
        oldSignal = signal
        return new Promise<ArrayBuffer>((_resolve, reject) => {
          rejectOld = reject
        })
      })
      .mockResolvedValue(new ArrayBuffer(8))
    const receivers: Array<(message: unknown) => void> = []
    vi.stubGlobal('browser', {
      runtime: {
        getURL: (path: string) => `moz-extension://test/${path}`,
        connect: () => {
          let receive: (message: unknown) => void = () => undefined
          return {
            onMessage: {
              addListener: (listener: typeof receive) => {
                receive = listener
                receivers.push(listener)
              },
              removeListener: vi.fn(),
            },
            onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
            disconnect: vi.fn(),
            postMessage: (message: unknown) => {
              if (isHostRequest(message)) void host.handle(message).then((response) => receive(response))
            },
          }
        },
      },
    })
    const panel: StatusPanelContract = {
      addError: vi.fn(),
      addManualResult: vi.fn(),
      addRandomFailure: vi.fn(),
      addSuccess: vi.fn(),
      create: vi.fn(),
      destroy: vi.fn(),
      setSessionReady: vi.fn(),
      setStatus: vi.fn(),
    }
    const client = new RemoteDetectorClient(panel, () => app.recoverAfterModelCredentialsChanged())
    const otherClient = new RemoteDetectorClient(panel)
    const trigger = vi.fn(async () => ({ handled: true, captchaKey: null }))
    const app = new App({ panel, detector: client, solver: { isBusy: false, trigger } })
    app.init()
    const warmups = [
      client.prepare(app.getAbortSignal(), { silent: true }),
      otherClient.prepare(undefined, { silent: true }),
    ].map((promise) => promise.catch((error: unknown) => error))
    try {
      await vi.waitFor(() => expect(oldSignal).toBeInstanceOf(AbortSignal))
      const rotate = () =>
        host.handle(
          operation === 'verify-key'
            ? { protocol: PROTOCOL_VERSION, type: operation, requestId: 'rotate', candidateKey: 'a'.repeat(64) }
            : { protocol: PROTOCOL_VERSION, type: operation, requestId: 'rotate' },
        )
      await expect(rotate()).resolves.toMatchObject({ ok: true })
      for (const receive of receivers) receive({ protocol: PROTOCOL_VERSION, type: 'model-credentials-changed' })
      expect(document.getElementById('riddlemaster')).toBeNull()

      appendCaptcha()
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(3))
      rejectOld(new ModelAccessKeyRejectedError())
      await vi.waitFor(() => expect(trigger).toHaveBeenCalledTimes(1))
      expect(oldSignal?.aborted).toBe(true)
      expect(download).toHaveBeenCalledTimes(2)
      await Promise.all(warmups)

      // A later credential change must not discard the already usable session.
      await expect(rotate()).resolves.toMatchObject({ ok: true })
      await otherClient.prepare()
      expect(download).toHaveBeenCalledTimes(2)
    } finally {
      app.destroy()
      otherClient.destroy()
      host.destroy()
      rejectOld(new Error('test cleanup'))
      await Promise.all(warmups)
    }
  },
)
