export interface ContentRuntimeStorage {
  destroy(): void
}

export interface ContentRuntimeApp {
  init(): void
  destroy(): void
}

export async function startContentRuntime<TStorage extends ContentRuntimeStorage>(
  createStorage: () => Promise<TStorage>,
  createApp: (storage: TStorage) => ContentRuntimeApp,
  lifecycleTarget: EventTarget = globalThis,
): Promise<ContentRuntimeApp | null> {
  let pageHidden = false
  let storage: TStorage | null = null
  let app: ContentRuntimeApp | null = null

  const handlePageHide = (): void => {
    pageHidden = true
    if (app) {
      app.destroy()
      app = null
      storage = null
      return
    }
    storage?.destroy()
    storage = null
  }

  lifecycleTarget.addEventListener('pagehide', handlePageHide, { once: true })
  try {
    storage = await createStorage()
    if (pageHidden) {
      storage.destroy()
      storage = null
      return null
    }
    app = createApp(storage)
    app.init()
    return app
  } catch (error) {
    lifecycleTarget.removeEventListener('pagehide', handlePageHide)
    if (app) {
      app.destroy()
      app = null
    } else {
      storage?.destroy()
    }
    storage = null
    throw error
  }
}
