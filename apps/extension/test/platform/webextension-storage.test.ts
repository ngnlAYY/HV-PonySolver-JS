import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  addStorageChangeListener,
  storageGetAll,
  storageRemove,
  storageSet,
} from '../../src/platform/webextension-storage'
import type { RawExtensionApi } from '../../src/platform/webextension-api'
import { rawExtensionApi } from './webextension-api-fixture'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webextension storage adapter', () => {
  it('uses Firefox Promise storage methods and preserves change listener removal', async () => {
    const api = rawExtensionApi()
    vi.mocked(api.storage.local.get).mockResolvedValue({ answer: 42 })
    vi.mocked(api.storage.local.set).mockResolvedValue(undefined)
    vi.mocked(api.storage.local.remove).mockResolvedValue(undefined)
    vi.stubGlobal('browser', api)
    const listener = vi.fn()

    expect(await storageGetAll()).toEqual({ answer: 42 })
    await storageSet({ answer: 43 })
    await storageRemove('answer')
    const unregister = addStorageChangeListener(listener)
    unregister()

    expect(api.storage.local.get).toHaveBeenCalledWith(null)
    expect(api.storage.local.set).toHaveBeenCalledWith({ answer: 43 })
    expect(api.storage.local.remove).toHaveBeenCalledWith('answer')
    expect(api.storage.onChanged.removeListener).toHaveBeenCalledWith(listener)
  })

  it('rejects Chromium callback operations when runtime.lastError is set', async () => {
    const api = rawExtensionApi() as RawExtensionApi & {
      runtime: RawExtensionApi['runtime'] & { lastError?: { message?: string } }
    }
    vi.mocked(api.storage.local.set).mockImplementation((_items, callback) => {
      api.runtime.lastError = { message: 'storage failed' }
      callback?.()
      delete api.runtime.lastError
    })
    vi.stubGlobal('chrome', api)

    await expect(storageSet({ answer: 42 })).rejects.toThrow('storage failed')
  })
})
