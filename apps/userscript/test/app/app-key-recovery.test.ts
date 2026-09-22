import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelAccessKeyRejectedError } from '@hv-pony-solver/browser-core'
import { ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'

import { appendCaptcha } from '../../../../test/support/captcha-fixture'
import { SuccessfulWorker } from '../../../../test/support/mock-worker'
import { App } from '../../src/app/app'
import { OnnxWorkerClient } from '../../src/inference/onnx-worker-client'

const model = vi.hoisted(() => ({
  getCached: vi.fn<(signal?: AbortSignal) => Promise<ArrayBuffer | null>>(),
  download: vi.fn<() => Promise<ArrayBuffer>>(),
  putCached: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => void>(),
}))

vi.mock('../../src/model/model-cache', () => ({
  ModelCache: vi.fn(function ModelCacheMock() {
    return model
  }),
}))

vi.mock('../../src/captcha/captcha-image-loader', () => ({
  CachedImageLoader: vi.fn(function CachedImageLoaderMock() {
    return { get: async () => new Blob(['fixture'], { type: 'image/png' }) }
  }),
}))

const KEY_STORAGE_KEY = 'hvPonySolverModelAccessKey'
const TEST_KEY = 'a'.repeat(64)
const stored = new Map<string, string>()
const apps: App[] = []
const registerMenuCommand = vi.fn<(caption: string, action: () => void | Promise<void>) => void>()
const prompt = vi.fn<() => string | null>()
const setValue = vi.fn<(key: string, value: string) => Promise<void>>()
const deleteValue = vi.fn<(key: string) => Promise<void>>()
const fetchImpl = vi.fn<typeof fetch>()

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  const { promise, resolve } = Promise.withResolvers<T>()
  return { promise, resolve }
}

async function startApp(): Promise<{ app: App; captcha: ReturnType<typeof appendCaptcha> }> {
  const captcha = appendCaptcha('/key-recovery.png')
  const app = new App()
  apps.push(app)
  app.init()
  await vi.advanceTimersByTimeAsync(300)
  return { app, captcha }
}

async function runMenu(...choices: Array<string | null>): Promise<void> {
  for (const choice of choices) prompt.mockReturnValueOnce(choice)
  const action = registerMenuCommand.mock.calls[0]?.[1]
  if (!action) throw new Error('settings menu was not registered')
  await action()
}

function detects(): number {
  return SuccessfulWorker.messages.filter((message) => message.type === 'detect').length
}

describe('App GM Key commit recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    stored.clear()
    stored.set('hvPonySolverAnswerMode', 'manual')
    localStorage.clear()
    document.body.replaceChildren()
    SuccessfulWorker.reset()
    model.getCached.mockReset().mockResolvedValue(null)
    model.download.mockReset().mockImplementation(async () => {
      if (!stored.has(KEY_STORAGE_KEY)) throw new ModelAccessKeyRejectedError()
      return new Uint8Array([1, 2, 3]).buffer
    })
    model.putCached.mockResolvedValue(undefined)
    setValue.mockReset().mockImplementation(async (key, value) => {
      stored.set(key, value)
    })
    deleteValue.mockReset().mockImplementation(async (key) => {
      stored.delete(key)
    })
    prompt.mockReset().mockReturnValue(null)
    fetchImpl
      .mockReset()
      .mockImplementation(
        async () => new Response(null, { headers: { 'content-length': String(ORT_MODEL_INTEGRITY.byteLength) } }),
      )
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('GM_getValue', (key: string, fallback: string) => stored.get(key) ?? fallback)
    vi.stubGlobal('GM_setValue', setValue)
    vi.stubGlobal('GM_deleteValue', deleteValue)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', vi.fn())
    vi.stubGlobal('fetch', fetchImpl)
    vi.stubGlobal('Worker', SuccessfulWorker)
    vi.stubGlobal('__HV_PONY_SOLVER_TEST_WORKER_SCRIPT__', 'self.onmessage = () => {}')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:worker')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    for (const app of apps.splice(0)) app.destroy()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('retries the same failed captcha only after the verified GM Key write commits', async () => {
    const commit = deferred<void>()
    setValue.mockImplementationOnce(async (key, value) => {
      await commit.promise
      stored.set(key, value)
    })
    const cancelPreparation = vi.spyOn(OnnxWorkerClient.prototype, 'cancelPendingPreparation')
    await startApp()
    expect(model.download).toHaveBeenCalledTimes(1)
    expect(detects()).toBe(0)

    const saving = runMenu('1', TEST_KEY)
    await vi.advanceTimersByTimeAsync(0)
    expect(setValue).toHaveBeenCalledTimes(1)
    expect(stored.has(KEY_STORAGE_KEY)).toBe(false)
    expect(cancelPreparation).not.toHaveBeenCalled()
    expect(model.download).toHaveBeenCalledTimes(1)

    commit.resolve()
    await saving
    await vi.runAllTimersAsync()

    expect(cancelPreparation).toHaveBeenCalledTimes(1)
    expect(model.download).toHaveBeenCalledTimes(2)
    expect(detects()).toBe(1)
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'HEAD' }))
  })

  it.each([
    ['clear action', ['2']],
    ['blank Key prompt', ['1', '']],
  ])('recovers a failed target after a committed %s', async (_label, choices) => {
    stored.set(KEY_STORAGE_KEY, TEST_KEY)
    model.download.mockRejectedValue(new ModelAccessKeyRejectedError())
    const cancelPreparation = vi.spyOn(OnnxWorkerClient.prototype, 'cancelPendingPreparation')
    await startApp()

    await runMenu(...choices)
    await vi.runAllTimersAsync()

    expect(stored.has(KEY_STORAGE_KEY)).toBe(false)
    expect(deleteValue).toHaveBeenCalledTimes(1)
    expect(cancelPreparation).toHaveBeenCalledTimes(1)
    expect(model.download).toHaveBeenCalledTimes(2)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('settles the old preparation before retrying and ignores its late cache response', async () => {
    const oldCacheRead = deferred<ArrayBuffer | null>()
    let oldSignal: AbortSignal | undefined
    model.getCached.mockImplementationOnce((signal) => {
      oldSignal = signal
      return oldCacheRead.promise
    })
    await startApp()
    expect(model.getCached).toHaveBeenCalledTimes(1)

    await runMenu('1', TEST_KEY)
    // No transient-retry timer should be needed to escape an already-cancelled
    // initialization. The new preparation must begin after its teardown.
    await vi.advanceTimersByTimeAsync(0)
    expect(oldSignal?.aborted).toBe(true)
    expect(model.getCached).toHaveBeenCalledTimes(2)
    expect(detects()).toBe(1)

    oldCacheRead.resolve(new Uint8Array([9, 9, 9]).buffer)
    await vi.runAllTimersAsync()
    expect(SuccessfulWorker.instances).toHaveLength(1)
    expect(model.download).toHaveBeenCalledTimes(1)
    expect(detects()).toBe(1)
  })

  it.each([
    ['save', ['1', TEST_KEY]],
    ['clear', ['2']],
  ])('reuses a ready session after a Key %s', async (_label, choices) => {
    stored.set(KEY_STORAGE_KEY, TEST_KEY)
    const { captcha } = await startApp()
    expect(detects()).toBe(1)

    await runMenu(...choices)
    await vi.runAllTimersAsync()
    const image = captcha.querySelector('img')
    if (!image) throw new Error('captcha image was not created')
    image.src = '/next-captcha.png'
    await vi.runAllTimersAsync()

    expect(detects()).toBe(2)
    expect(model.download).toHaveBeenCalledTimes(1)
    expect(SuccessfulWorker.instances).toHaveLength(1)
    expect(SuccessfulWorker.terminateCount).toBe(0)
  })

  it.each(['save', 'clear'] as const)('keeps the failed target unchanged when GM %s rejects', async (operation) => {
    const failure = new Error('fixture storage failure')
    if (operation === 'save') setValue.mockRejectedValueOnce(failure)
    else deleteValue.mockRejectedValueOnce(failure)
    const recover = vi.spyOn(App.prototype, 'recoverAfterModelCredentialsChanged')
    const cancelPreparation = vi.spyOn(OnnxWorkerClient.prototype, 'cancelPendingPreparation')
    await startApp()

    await runMenu(...(operation === 'save' ? ['1', TEST_KEY] : ['2']))
    await vi.runAllTimersAsync()

    expect(recover).not.toHaveBeenCalled()
    expect(cancelPreparation).not.toHaveBeenCalled()
    expect(model.download).toHaveBeenCalledTimes(1)
    expect(detects()).toBe(0)
  })

  it('does not recover or change storage when the Key prompt is cancelled', async () => {
    const recover = vi.spyOn(App.prototype, 'recoverAfterModelCredentialsChanged')
    await startApp()

    await runMenu('1', null)
    await vi.runAllTimersAsync()

    expect(recover).not.toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
    expect(deleteValue).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(model.download).toHaveBeenCalledTimes(1)
  })

  it('does not recover after Key verification rejects', async () => {
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 403 }))
    const recover = vi.spyOn(App.prototype, 'recoverAfterModelCredentialsChanged')
    await startApp()

    await runMenu('1', TEST_KEY)
    await vi.runAllTimersAsync()

    expect(recover).not.toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
    expect(model.download).toHaveBeenCalledTimes(1)
  })

  it('does not revive a destroyed App when an already-started GM write commits late', async () => {
    const commit = deferred<void>()
    setValue.mockImplementationOnce(async (key, value) => {
      await commit.promise
      stored.set(key, value)
    })
    const recover = vi.spyOn(App.prototype, 'recoverAfterModelCredentialsChanged')
    const cancelPreparation = vi.spyOn(OnnxWorkerClient.prototype, 'cancelPendingPreparation')
    const { app } = await startApp()

    const saving = runMenu('1', TEST_KEY)
    await vi.advanceTimersByTimeAsync(0)
    app.destroy()
    commit.resolve()
    await saving
    await vi.runAllTimersAsync()

    expect(stored.has(KEY_STORAGE_KEY)).toBe(true)
    expect(recover).not.toHaveBeenCalled()
    expect(cancelPreparation).not.toHaveBeenCalled()
    expect(model.download).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.ponyLog')).toBeNull()
  })

  it('ignores an older commit notification after a newer Key change has recovered the target', async () => {
    const settling = deferred<void>()
    const originalCancel = OnnxWorkerClient.prototype.cancelPendingPreparation
    vi.spyOn(OnnxWorkerClient.prototype, 'cancelPendingPreparation').mockImplementationOnce(async function (
      this: OnnxWorkerClient,
    ) {
      await originalCancel.call(this)
      await settling.promise
    })
    const recover = vi.spyOn(App.prototype, 'recoverAfterModelCredentialsChanged')
    await startApp()

    const saving = runMenu('1', TEST_KEY)
    await vi.advanceTimersByTimeAsync(0)
    await runMenu('2')
    await vi.runAllTimersAsync()
    expect(recover).toHaveBeenCalledTimes(1)
    expect(model.download).toHaveBeenCalledTimes(2)

    settling.resolve()
    await saving
    await vi.runAllTimersAsync()
    expect(recover).toHaveBeenCalledTimes(1)
    expect(model.download).toHaveBeenCalledTimes(2)
    expect(stored.has(KEY_STORAGE_KEY)).toBe(false)
  })

  it('does not recover if App destruction happens while preparation teardown is settling', async () => {
    const settling = deferred<void>()
    const originalCancel = OnnxWorkerClient.prototype.cancelPendingPreparation
    vi.spyOn(OnnxWorkerClient.prototype, 'cancelPendingPreparation').mockImplementationOnce(async function (
      this: OnnxWorkerClient,
    ) {
      await originalCancel.call(this)
      await settling.promise
    })
    const recover = vi.spyOn(App.prototype, 'recoverAfterModelCredentialsChanged')
    const { app } = await startApp()

    const saving = runMenu('1', TEST_KEY)
    await vi.advanceTimersByTimeAsync(0)
    expect(stored.has(KEY_STORAGE_KEY)).toBe(true)
    app.destroy()
    settling.resolve()
    await saving
    await vi.runAllTimersAsync()

    expect(recover).not.toHaveBeenCalled()
    expect(model.download).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.ponyLog')).toBeNull()
  })
})
