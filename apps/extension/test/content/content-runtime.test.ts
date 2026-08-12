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

describe('startContentRuntime', () => {
  it('does not initialize after pagehide during asynchronous storage creation', async () => {
    const lifecycleTarget = new EventTarget()
    const pendingStorage = deferred<ContentRuntimeStorage>()
    const storage: ContentRuntimeStorage = { destroy: vi.fn() }
    const createApp = vi.fn<(storage: ContentRuntimeStorage) => ContentRuntimeApp>()
    const startPromise = startContentRuntime(() => pendingStorage.promise, createApp, lifecycleTarget)

    lifecycleTarget.dispatchEvent(new Event('pagehide'))
    pendingStorage.resolve(storage)

    await expect(startPromise).resolves.toBeNull()
    expect(createApp).not.toHaveBeenCalled()
    expect(storage.destroy).toHaveBeenCalledTimes(1)
  })

  it('initializes once and destroys the app on pagehide', async () => {
    const lifecycleTarget = new EventTarget()
    const storage: ContentRuntimeStorage = { destroy: vi.fn() }
    const app: ContentRuntimeApp = { init: vi.fn(), destroy: vi.fn() }

    await expect(
      startContentRuntime(
        async () => storage,
        () => app,
        lifecycleTarget,
      ),
    ).resolves.toBe(app)
    lifecycleTarget.dispatchEvent(new Event('pagehide'))

    expect(app.init).toHaveBeenCalledTimes(1)
    expect(app.destroy).toHaveBeenCalledTimes(1)
    expect(storage.destroy).not.toHaveBeenCalled()
  })
})
