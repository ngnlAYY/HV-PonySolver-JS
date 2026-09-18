import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  addRuntimeConnectListener,
  readPortDisconnectError,
  runtimeGetUrl,
  runtimeId,
  sendRuntimeMessage,
} from '../../src/platform/webextension-runtime'
import type { ExtensionPort, RawExtensionApi } from '../../src/platform/webextension-api'
import { extensionEvent, rawExtensionApi } from './webextension-api-fixture'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webextension runtime adapter', () => {
  it.each([
    { runtimeMessage: ' Chrome port closed ', portMessage: undefined, expected: 'Chrome port closed' },
    { runtimeMessage: undefined, portMessage: ' Firefox port closed ', expected: 'Firefox port closed' },
    { runtimeMessage: ' ', portMessage: 'Firefox port closed', expected: 'Firefox port closed' },
    { runtimeMessage: undefined, portMessage: undefined, expected: undefined },
    { runtimeMessage: '', portMessage: ' ', expected: undefined },
  ])('reads Port disconnect errors across browser APIs: $expected', ({ runtimeMessage, portMessage, expected }) => {
    const api = rawExtensionApi()
    const readLastError = vi.fn(() => (runtimeMessage === undefined ? undefined : { message: runtimeMessage }))
    Object.defineProperty(api.runtime, 'lastError', { get: readLastError })
    vi.stubGlobal(runtimeMessage === undefined ? 'browser' : 'chrome', api)
    const port: ExtensionPort = {
      name: 'test',
      ...(portMessage === undefined ? {} : { error: { message: portMessage } }),
      onMessage: extensionEvent(),
      onDisconnect: extensionEvent(),
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    }

    const error = readPortDisconnectError(port)

    expect(readLastError).toHaveBeenCalledTimes(1)
    if (expected === undefined) expect(error).toBeNull()
    else expect(error?.message).toBe(expected)
  })

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
