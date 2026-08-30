import { describe, expect, it, vi } from 'vitest'

import {
  startContentRuntime,
  type ContentRuntimeApp,
  type ContentRuntimeStorage,
} from '../../src/content/content-runtime'

function deferred<T>(): Readonly<{
  promise: Promise<T>
  resolve(value: T): void
}> {
  let resolvePromise!: (value: T) => void
  return {
    promise: new Promise<T>((resolve) => {
      resolvePromise = resolve
    }),
    resolve: resolvePromise,
  }
}

function pageTransition(type: 'pagehide' | 'pageshow', persisted: boolean): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'persisted', { value: persisted })
  return event
}

function runtimeApp(): ContentRuntimeApp {
  return { init: vi.fn(), destroy: vi.fn() }
}

describe('startContentRuntime', () => {
  it('destroys candidate storage when application construction throws', async () => {
    const lifecycleTarget = new EventTarget()
    const storage: ContentRuntimeStorage = { destroy: vi.fn() }
    const constructionError = new Error('application construction failed')

    await expect(
      startContentRuntime(
        async () => storage,
        () => {
          throw constructionError
        },
        lifecycleTarget,
      ),
    ).rejects.toBe(constructionError)
    expect(storage.destroy).toHaveBeenCalledTimes(1)
  })

  it('does not initialize after an ordinary pagehide during asynchronous storage creation', async () => {
    const lifecycleTarget = new EventTarget()
    const pendingStorage = deferred<ContentRuntimeStorage>()
    const storage: ContentRuntimeStorage = { destroy: vi.fn() }
    const createApp = vi.fn<(storage: ContentRuntimeStorage) => ContentRuntimeApp>()
    const startPromise = startContentRuntime(() => pendingStorage.promise, createApp, lifecycleTarget)

    lifecycleTarget.dispatchEvent(pageTransition('pagehide', false))
    lifecycleTarget.dispatchEvent(pageTransition('pagehide', false))
    pendingStorage.resolve(storage)

    await expect(startPromise).resolves.toBeNull()
    expect(createApp).not.toHaveBeenCalled()
    expect(storage.destroy).toHaveBeenCalledTimes(1)
  })

  it('initializes once and cleans an ordinary unload only once', async () => {
    const lifecycleTarget = new EventTarget()
    const storage: ContentRuntimeStorage = { destroy: vi.fn() }
    const app = runtimeApp()

    await expect(
      startContentRuntime(
        async () => storage,
        () => app,
        lifecycleTarget,
      ),
    ).resolves.toBe(app)
    lifecycleTarget.dispatchEvent(pageTransition('pagehide', false))
    lifecycleTarget.dispatchEvent(pageTransition('pagehide', false))
    lifecycleTarget.dispatchEvent(pageTransition('pageshow', true))

    expect(app.init).toHaveBeenCalledTimes(1)
    expect(app.destroy).toHaveBeenCalledTimes(1)
    expect(storage.destroy).not.toHaveBeenCalled()
  })

  it('fully rebuilds the runtime when the same Document returns from BFCache', async () => {
    const lifecycleTarget = new EventTarget()
    const firstStorage: ContentRuntimeStorage = { destroy: vi.fn() }
    const secondStorage: ContentRuntimeStorage = { destroy: vi.fn() }
    const firstApp = runtimeApp()
    const secondApp = runtimeApp()
    const createStorage = vi
      .fn<() => Promise<ContentRuntimeStorage>>()
      .mockResolvedValueOnce(firstStorage)
      .mockResolvedValueOnce(secondStorage)
    const createApp = vi
      .fn<(storage: ContentRuntimeStorage) => ContentRuntimeApp>()
      .mockReturnValueOnce(firstApp)
      .mockReturnValueOnce(secondApp)

    await expect(startContentRuntime(createStorage, createApp, lifecycleTarget)).resolves.toBe(firstApp)

    lifecycleTarget.dispatchEvent(pageTransition('pagehide', true))
    expect(firstApp.destroy).toHaveBeenCalledTimes(1)
    lifecycleTarget.dispatchEvent(pageTransition('pageshow', true))

    await vi.waitFor(() => expect(secondApp.init).toHaveBeenCalledTimes(1))
    expect(createStorage).toHaveBeenCalledTimes(2)
    expect(createApp).toHaveBeenNthCalledWith(2, secondStorage)
    expect(secondApp.destroy).not.toHaveBeenCalled()

    lifecycleTarget.dispatchEvent(pageTransition('pagehide', false))
    lifecycleTarget.dispatchEvent(pageTransition('pagehide', false))
    expect(secondApp.destroy).toHaveBeenCalledTimes(1)
  })

  it('makes a failed BFCache restore terminal after cleaning the failed candidate', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const lifecycleTarget = new EventTarget()
    const firstStorage: ContentRuntimeStorage = { destroy: vi.fn() }
    const failedStorage: ContentRuntimeStorage = { destroy: vi.fn() }
    const unexpectedStorage: ContentRuntimeStorage = { destroy: vi.fn() }
    const firstApp = runtimeApp()
    const failedApp = runtimeApp()
    const unexpectedApp = runtimeApp()
    vi.mocked(failedApp.init).mockImplementation(() => {
      throw new Error('restore failed')
    })
    const createStorage = vi
      .fn<() => Promise<ContentRuntimeStorage>>()
      .mockResolvedValueOnce(firstStorage)
      .mockResolvedValueOnce(failedStorage)
      .mockResolvedValueOnce(unexpectedStorage)
    const createApp = vi
      .fn<(storage: ContentRuntimeStorage) => ContentRuntimeApp>()
      .mockReturnValueOnce(firstApp)
      .mockReturnValueOnce(failedApp)
      .mockReturnValueOnce(unexpectedApp)

    await expect(startContentRuntime(createStorage, createApp, lifecycleTarget)).resolves.toBe(firstApp)
    lifecycleTarget.dispatchEvent(pageTransition('pagehide', true))
    lifecycleTarget.dispatchEvent(pageTransition('pageshow', true))
    await vi.waitFor(() => expect(failedApp.destroy).toHaveBeenCalledTimes(1))

    lifecycleTarget.dispatchEvent(pageTransition('pagehide', true))
    lifecycleTarget.dispatchEvent(pageTransition('pageshow', true))
    await Promise.resolve()

    expect(createStorage).toHaveBeenCalledTimes(2)
    expect(unexpectedApp.init).not.toHaveBeenCalled()
    expect(firstApp.destroy).toHaveBeenCalledTimes(1)
    expect(failedStorage.destroy).not.toHaveBeenCalled()
  })

  it('invalidates an in-flight initialization and restores from BFCache without stale ownership', async () => {
    const lifecycleTarget = new EventTarget()
    const firstStorageCreation = deferred<ContentRuntimeStorage>()
    const restoredStorageCreation = deferred<ContentRuntimeStorage>()
    const staleStorage: ContentRuntimeStorage = { destroy: vi.fn() }
    const restoredStorage: ContentRuntimeStorage = { destroy: vi.fn() }
    const restoredApp = runtimeApp()
    const createStorage = vi
      .fn<() => Promise<ContentRuntimeStorage>>()
      .mockReturnValueOnce(firstStorageCreation.promise)
      .mockReturnValueOnce(restoredStorageCreation.promise)
    const createApp = vi.fn(() => restoredApp)

    const startPromise = startContentRuntime(createStorage, createApp, lifecycleTarget)
    lifecycleTarget.dispatchEvent(pageTransition('pagehide', true))
    lifecycleTarget.dispatchEvent(pageTransition('pageshow', true))
    restoredStorageCreation.resolve(restoredStorage)

    await vi.waitFor(() => expect(restoredApp.init).toHaveBeenCalledTimes(1))
    expect(createApp).toHaveBeenCalledWith(restoredStorage)

    firstStorageCreation.resolve(staleStorage)
    await expect(startPromise).resolves.toBeNull()
    expect(staleStorage.destroy).toHaveBeenCalledTimes(1)
    expect(restoredStorage.destroy).not.toHaveBeenCalled()
    expect(restoredApp.destroy).not.toHaveBeenCalled()

    lifecycleTarget.dispatchEvent(pageTransition('pagehide', false))
    expect(restoredApp.destroy).toHaveBeenCalledTimes(1)
  })
})
