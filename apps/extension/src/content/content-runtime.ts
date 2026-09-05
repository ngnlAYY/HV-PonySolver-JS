import { logError } from '@hv-pony-solver/browser-core/utils/logger'

export interface ContentRuntimeStorage {
  destroy(): void
}

export interface ContentRuntimeApp {
  init(): void
  destroy(): void
}

function isPersistedPageTransition(event: Event): boolean {
  return (event as Event & { persisted?: unknown }).persisted === true
}

function reportRestoreError(error: unknown): void {
  logError('扩展恢复失败:', error instanceof Error ? error.message : String(error))
}

export async function startContentRuntime<TStorage extends ContentRuntimeStorage>(
  createStorage: (signal: AbortSignal) => Promise<TStorage>,
  createApp: (storage: TStorage) => ContentRuntimeApp,
  lifecycleTarget: EventTarget = globalThis,
): Promise<ContentRuntimeApp | null> {
  let terminal = false
  let suspended = false
  let listening = true
  let generation = 0
  let storage: TStorage | null = null
  let app: ContentRuntimeApp | null = null
  let initializingStorage: AbortController | null = null

  const stopListening = (): void => {
    if (!listening) {
      return
    }
    listening = false
    lifecycleTarget.removeEventListener('pagehide', handlePageHide)
    lifecycleTarget.removeEventListener('pageshow', handlePageShow)
  }

  const destroyActiveRuntime = (): void => {
    initializingStorage?.abort(new Error('扩展页面初始化已取消'))
    initializingStorage = null
    const activeApp = app
    const activeStorage = storage
    app = null
    storage = null
    if (activeApp) {
      activeApp.destroy()
    } else {
      activeStorage?.destroy()
    }
  }

  const initialize = async (): Promise<ContentRuntimeApp | null> => {
    const attemptGeneration = ++generation
    const storageController = new AbortController()
    initializingStorage?.abort(new Error('扩展页面初始化已被替换'))
    initializingStorage = storageController
    let candidateStorage: TStorage | null = null
    let candidateApp: ContentRuntimeApp | null = null
    let ownershipTransferred = false
    let candidateDestroyed = false

    const isCurrent = (): boolean => !terminal && !suspended && generation === attemptGeneration

    const destroyCandidate = (): void => {
      if (candidateDestroyed) {
        return
      }
      candidateDestroyed = true
      if (candidateApp) {
        candidateApp.destroy()
      } else {
        candidateStorage?.destroy()
      }
      candidateApp = null
      candidateStorage = null
    }

    try {
      candidateStorage = await createStorage(storageController.signal)
      if (!isCurrent()) {
        destroyCandidate()
        return null
      }

      candidateApp = createApp(candidateStorage)
      if (!isCurrent()) {
        destroyCandidate()
        return null
      }

      storage = candidateStorage
      app = candidateApp
      ownershipTransferred = true
      candidateApp.init()
      if (!isCurrent() || app !== candidateApp) {
        return null
      }
      return candidateApp
    } catch (error) {
      if (ownershipTransferred) {
        if (app === candidateApp) {
          destroyActiveRuntime()
        }
      } else {
        destroyCandidate()
      }
      if (!isCurrent()) {
        return null
      }
      throw error
    } finally {
      if (initializingStorage === storageController) initializingStorage = null
    }
  }

  function handlePageHide(event: Event): void {
    if (terminal) {
      return
    }
    generation += 1
    if (isPersistedPageTransition(event)) {
      suspended = true
    } else {
      terminal = true
      suspended = false
      stopListening()
    }
    destroyActiveRuntime()
  }

  function handlePageShow(event: Event): void {
    if (terminal || !suspended || !isPersistedPageTransition(event)) {
      return
    }
    suspended = false
    void initialize().catch((error: unknown) => {
      reportRestoreError(error)
      terminal = true
      suspended = false
      generation += 1
      stopListening()
      destroyActiveRuntime()
    })
  }

  lifecycleTarget.addEventListener('pagehide', handlePageHide)
  lifecycleTarget.addEventListener('pageshow', handlePageShow)
  try {
    return await initialize()
  } catch (error) {
    terminal = true
    generation += 1
    stopListening()
    destroyActiveRuntime()
    throw error
  }
}
