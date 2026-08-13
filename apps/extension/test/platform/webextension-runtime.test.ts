import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  addRuntimeConnectListener,
  runtimeGetUrl,
  runtimeId,
  sendRuntimeMessage,
} from '../../src/platform/webextension-runtime'
import type { RawExtensionApi } from '../../src/platform/webextension-api'
import { rawExtensionApi } from './webextension-api-fixture'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webextension runtime adapter', () => {
  it('uses Firefox Promise APIs and unregisters listeners', async () => {
    const api = rawExtensionApi()
    vi.mocked(api.runtime.sendMessage).mockResolvedValue({ ok: true })
    vi.stubGlobal('browser', api)
    const listener = vi.fn()

    const unregister = addRuntimeConnectListener(listener)

    expect(runtimeId()).toBe('extension-id')
    expect(runtimeGetUrl('options.html')).toBe('moz-extension://extension-id/options.html')
    await expect(sendRuntimeMessage({ ping: true })).resolves.toEqual({ ok: true })
    unregister()
    expect(api.runtime.onConnect.removeListener).toHaveBeenCalledWith(listener)
  })

  it('turns Chromium runtime.lastError into a rejected Promise', async () => {
    const api = rawExtensionApi() as RawExtensionApi & {
      runtime: RawExtensionApi['runtime'] & { lastError?: { message?: string } }
    }
    vi.mocked(api.runtime.sendMessage).mockImplementation((_message, callback) => {
      api.runtime.lastError = { message: 'callback failed' }
      callback?.(undefined)
      delete api.runtime.lastError
    })
    vi.stubGlobal('chrome', api)

    await expect(sendRuntimeMessage({ ping: true })).rejects.toThrow('callback failed')
  })
})
