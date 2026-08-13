import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ANSWER_MODE_STORAGE_KEY,
  MULTI_CLICK_DELAY_STORAGE_KEY,
  PANEL_HISTORY_LIMIT_STORAGE_KEY,
  PANEL_POSITION_STORAGE_KEY,
  RANDOM_ON_FAIL_STORAGE_KEY,
  SUBMIT_DELAY_STORAGE_KEY,
} from '@hv-pony-solver/browser-core'

import { installOptionsPageMarkup, optionsElement } from './options-page-fixture'

const platformMocks = vi.hoisted(() => ({
  runtimeConnect: vi.fn(),
  storageGetAll: vi.fn(),
  storageRemove: vi.fn(),
  storageSet: vi.fn(),
}))
const forbiddenModuleMocks = vi.hoisted(() => ({
  indexedDbModuleLoaded: vi.fn(),
  indexedDbStorageConstructed: vi.fn(),
  protocolModuleLoaded: vi.fn(),
}))
const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')

vi.mock('../../src/platform/webextension', () => platformMocks)
vi.mock('../../src/host/indexeddb-string-storage', () => {
  forbiddenModuleMocks.indexedDbModuleLoaded()
  return {
    IndexedDbStringStorage: class {
      constructor() {
        forbiddenModuleMocks.indexedDbStorageConstructed()
      }
    },
  }
})
vi.mock('../../src/protocol/messages', () => {
  forbiddenModuleMocks.protocolModuleLoaded()
  return {}
})

beforeEach(() => {
  vi.resetModules()
  platformMocks.runtimeConnect.mockReset()
  platformMocks.storageGetAll.mockReset().mockResolvedValue({
    // A local-storage sentinel must be ignored just like a dormant Key from an older artifact.
    hvPonySolverModelAccessKey: 'legacy-key-must-remain-dormant',
  })
  platformMocks.storageRemove.mockReset().mockResolvedValue(undefined)
  platformMocks.storageSet.mockReset().mockResolvedValue(undefined)
  forbiddenModuleMocks.indexedDbModuleLoaded.mockClear()
  forbiddenModuleMocks.indexedDbStorageConstructed.mockClear()
  forbiddenModuleMocks.protocolModuleLoaded.mockClear()
  installOptionsPageMarkup()
})

afterEach(() => {
  if (originalIndexedDbDescriptor) {
    Object.defineProperty(globalThis, 'indexedDB', originalIndexedDbDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'indexedDB')
  }
})

describe('packaged options entry', () => {
  it('shows the exact persistent hint without reaching Key, Port, or IndexedDB code', async () => {
    const indexedDbOpen = vi.fn()
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { open: indexedDbOpen },
    })

    await import('../../src/options/packaged')
    await vi.waitFor(() => expect(platformMocks.storageGetAll).toHaveBeenCalledTimes(1))

    expect(optionsElement<HTMLFieldSetElement>('model-key-fieldset').disabled).toBe(true)
    const hint = optionsElement<HTMLParagraphElement>('packaged-model-hint')
    expect(hint.hidden).toBe(false)
    expect(hint.textContent).toBe('当前版本已内置模型，无需配置模型 Key。')
    expect(platformMocks.runtimeConnect).not.toHaveBeenCalled()
    expect(forbiddenModuleMocks.protocolModuleLoaded).not.toHaveBeenCalled()
    expect(forbiddenModuleMocks.indexedDbModuleLoaded).not.toHaveBeenCalled()
    expect(forbiddenModuleMocks.indexedDbStorageConstructed).not.toHaveBeenCalled()
    expect(indexedDbOpen).not.toHaveBeenCalled()
  })

  it('keeps ordinary Save enabled and stores only ordinary settings', async () => {
    await import('../../src/options/packaged')
    await vi.waitFor(() => expect(platformMocks.storageGetAll).toHaveBeenCalledTimes(1))

    const saveButton = document.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(saveButton?.disabled).toBe(false)

    optionsElement<HTMLSelectElement>('answer-mode').value = 'manual'
    optionsElement<HTMLInputElement>('submit-delay').value = '2400-2600'
    optionsElement<HTMLInputElement>('multi-click-delay').value = '50'
    optionsElement<HTMLInputElement>('panel-position').value = '10,20'
    optionsElement<HTMLInputElement>('history-limit').value = '8'
    optionsElement<HTMLInputElement>('random-on-fail').checked = false
    optionsElement<HTMLFormElement>('settings-form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )

    await vi.waitFor(() => expect(platformMocks.storageSet).toHaveBeenCalledTimes(1))
    expect(platformMocks.storageSet).toHaveBeenCalledWith({
      [ANSWER_MODE_STORAGE_KEY]: 'manual',
      [SUBMIT_DELAY_STORAGE_KEY]: '2400-2600',
      [MULTI_CLICK_DELAY_STORAGE_KEY]: '50',
      [PANEL_POSITION_STORAGE_KEY]: '10,20',
      [PANEL_HISTORY_LIMIT_STORAGE_KEY]: '8',
      [RANDOM_ON_FAIL_STORAGE_KEY]: '0',
    })
    expect(platformMocks.storageRemove).toHaveBeenCalledTimes(1)
    expect(platformMocks.runtimeConnect).not.toHaveBeenCalled()
    expect(forbiddenModuleMocks.indexedDbStorageConstructed).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toContain('设置已保存')
    })
  })

  it('renders hostile storage errors as text', async () => {
    platformMocks.storageGetAll.mockRejectedValueOnce(new Error('<img src=x onerror=alert(1)>'))

    await import('../../src/options/packaged')

    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('<img src=x onerror=alert(1)>')
    })
    expect(optionsElement<HTMLOutputElement>('status').dataset.kind).toBe('error')
    expect(document.querySelector('img')).toBeNull()
  })
})
