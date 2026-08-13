import { vi } from 'vitest'

import type { ExtensionEvent, RawExtensionApi } from '../../src/platform/webextension-api'

export function extensionEvent<Listener>(): ExtensionEvent<Listener> & {
  emit(...args: Listener extends (...values: infer Args) => unknown ? Args : never): void
} {
  const listeners = new Set<Listener>()
  return {
    addListener: vi.fn((listener: Listener) => listeners.add(listener)),
    removeListener: vi.fn((listener: Listener) => listeners.delete(listener)),
    emit: (...args) => {
      for (const listener of listeners) {
        ;(listener as (...values: typeof args) => unknown)(...args)
      }
    },
  }
}

export function rawExtensionApi(): RawExtensionApi {
  return {
    runtime: {
      id: 'extension-id',
      getURL: vi.fn((path: string) => `moz-extension://extension-id/${path}`),
      connect: vi.fn(),
      onConnect: extensionEvent(),
      onMessage: extensionEvent(),
      sendMessage: vi.fn(),
      getContexts: vi.fn(async () => []),
      openOptionsPage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
      },
      onChanged: extensionEvent(),
    },
    offscreen: {
      createDocument: vi.fn(async () => undefined),
    },
    action: {
      onClicked: extensionEvent(),
    },
  }
}
