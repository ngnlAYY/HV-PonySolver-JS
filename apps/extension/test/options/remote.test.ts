import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installOptionsPageMarkup, optionsElement } from './options-page-fixture'

type MessageListener = (message: unknown) => void

const platformMocks = vi.hoisted(() => ({
  runtimeConnect: vi.fn(),
  storageGetAll: vi.fn(),
  storageRemove: vi.fn(),
  storageSet: vi.fn(),
}))
const secretStorageMocks = vi.hoisted(() => ({
  close: vi.fn(),
  constructed: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  set: vi.fn(),
}))

vi.mock('../../src/platform/webextension', () => platformMocks)
vi.mock('../../src/host/indexeddb-string-storage', () => ({
  IndexedDbStringStorage: class {
    constructor() {
      secretStorageMocks.constructed()
    }

    get(key: string): Promise<string | null> {
      return secretStorageMocks.get(key)
    }

    set(key: string, value: string): Promise<void> {
      return secretStorageMocks.set(key, value)
    }

    remove(key: string): Promise<void> {
      return secretStorageMocks.remove(key)
    }

    close(): Promise<void> {
      return secretStorageMocks.close()
    }
  },
}))

function successfulHostPort(): Readonly<{ postMessage: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> &
  Record<string, unknown> {
  let messageListener: MessageListener | undefined
  return {
    name: 'hv-pony-solver:options',
    onMessage: {
      addListener(listener: MessageListener) {
        messageListener = listener
      },
      removeListener: vi.fn(),
    },
    onDisconnect: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    postMessage: vi.fn((message: Record<string, unknown>) => {
      queueMicrotask(() => {
        messageListener?.({
          protocol: 'hv-pony-solver/1',
          type: 'result',
          requestId: message.requestId,
          ok: true,
        })
      })
    }),
    disconnect: vi.fn(),
  }
}

beforeEach(() => {
  vi.resetModules()
  platformMocks.runtimeConnect.mockReset().mockReturnValue(successfulHostPort())
  platformMocks.storageGetAll.mockReset().mockResolvedValue({})
  platformMocks.storageRemove.mockReset().mockResolvedValue(undefined)
  platformMocks.storageSet.mockReset().mockResolvedValue(undefined)
  secretStorageMocks.close.mockReset().mockResolvedValue(undefined)
  secretStorageMocks.constructed.mockReset()
  secretStorageMocks.get.mockReset().mockResolvedValue('a'.repeat(64))
  secretStorageMocks.remove.mockReset().mockResolvedValue(undefined)
  secretStorageMocks.set.mockReset().mockResolvedValue(undefined)
  installOptionsPageMarkup()
})

describe('default remote options entry', () => {
  it('installs Key handlers before enabling the fieldset and preserves Key actions', async () => {
    await import('../../src/options/main')

    expect(optionsElement<HTMLFieldSetElement>('model-key-fieldset').disabled).toBe(false)
    expect(optionsElement<HTMLParagraphElement>('packaged-model-hint').hidden).toBe(true)
    expect(secretStorageMocks.constructed).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('已配置模型 Key（不会回显）')
    })

    const candidateKey = 'b'.repeat(64)
    optionsElement<HTMLInputElement>('model-key').value = candidateKey
    optionsElement<HTMLButtonElement>('verify-key').click()

    await vi.waitFor(() => expect(platformMocks.runtimeConnect).toHaveBeenCalledWith('hv-pony-solver:options'))
    const port = platformMocks.runtimeConnect.mock.results[0]?.value as { postMessage: ReturnType<typeof vi.fn> }
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      protocol: 'hv-pony-solver/1',
      type: 'verify-key',
      candidateKey,
    }))
    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 验证成功并已安全保存')
    })
    expect(optionsElement<HTMLInputElement>('model-key').value).toBe('')

    optionsElement<HTMLButtonElement>('clear-key').click()
    await vi.waitFor(() => expect(secretStorageMocks.remove).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 已清除')
    })

    globalThis.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(secretStorageMocks.close).toHaveBeenCalledTimes(1))
  })
})
