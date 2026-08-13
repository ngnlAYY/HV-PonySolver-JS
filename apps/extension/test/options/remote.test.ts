import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

    get(key: string, _signal?: AbortSignal): Promise<string | null> {
      return secretStorageMocks.get(key)
    }

    set(key: string, value: string, _signal?: AbortSignal): Promise<void> {
      return secretStorageMocks.set(key, value)
    }

    remove(key: string, _signal?: AbortSignal): Promise<void> {
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

function controlledHostPort(): Readonly<{
  disconnect: ReturnType<typeof vi.fn>
  emitDisconnect(): void
  emitMessage(message: unknown): void
  postMessage: ReturnType<typeof vi.fn>
}> &
  Record<string, unknown> {
  let messageListener: MessageListener | undefined
  let disconnectListener: (() => void) | undefined
  return {
    name: 'hv-pony-solver:options',
    onMessage: {
      addListener(listener: MessageListener) {
        messageListener = listener
      },
      removeListener: vi.fn((listener: MessageListener) => {
        if (messageListener === listener) {
          messageListener = undefined
        }
      }),
    },
    onDisconnect: {
      addListener(listener: () => void) {
        disconnectListener = listener
      },
      removeListener: vi.fn((listener: () => void) => {
        if (disconnectListener === listener) {
          disconnectListener = undefined
        }
      }),
    },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    emitMessage: (message) => messageListener?.(message),
    emitDisconnect: () => disconnectListener?.(),
  }
}

beforeEach(() => {
  vi.useRealTimers()
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

afterEach(() => {
  globalThis.dispatchEvent(new Event('pagehide'))
  vi.useRealTimers()
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

  it('makes verify then clear latest-operation-wins with no late success mutation', async () => {
    const hostPort = controlledHostPort()
    platformMocks.runtimeConnect.mockReturnValue(hostPort)
    await import('../../src/options/main')
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('已配置模型 Key（不会回显）'),
    )
    optionsElement<HTMLInputElement>('model-key').value = 'b'.repeat(64)
    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() => expect(hostPort.postMessage).toHaveBeenCalledTimes(1))

    optionsElement<HTMLButtonElement>('clear-key').click()

    await vi.waitFor(() => expect(secretStorageMocks.remove).toHaveBeenCalledTimes(1))
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 已清除'),
    )
    expect(hostPort.disconnect).toHaveBeenCalledTimes(1)
    const request = hostPort.postMessage.mock.calls[0]![0] as { requestId: string }
    hostPort.emitMessage({
      protocol: 'hv-pony-solver/1',
      type: 'result',
      requestId: request.requestId,
      ok: true,
    })
    await Promise.resolve()
    expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 已清除')
    expect(optionsElement<HTMLInputElement>('model-key').value).toBe('')
  })

  it('commits only the newest verify request and generates collision-safe IDs', async () => {
    const firstPort = controlledHostPort()
    const secondPort = successfulHostPort()
    platformMocks.runtimeConnect.mockReturnValueOnce(firstPort).mockReturnValueOnce(secondPort)
    await import('../../src/options/main')
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('已配置模型 Key（不会回显）'),
    )
    const input = optionsElement<HTMLInputElement>('model-key')
    input.value = 'b'.repeat(64)
    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() => expect(firstPort.postMessage).toHaveBeenCalledTimes(1))

    input.value = 'c'.repeat(64)
    optionsElement<HTMLButtonElement>('verify-key').click()

    await vi.waitFor(() => expect(secondPort.postMessage).toHaveBeenCalledTimes(1))
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 验证成功并已安全保存'),
    )
    const firstRequest = firstPort.postMessage.mock.calls[0]![0] as { requestId: string }
    const secondRequest = secondPort.postMessage.mock.calls[0]![0] as { requestId: string }
    expect(firstRequest.requestId).not.toBe(secondRequest.requestId)
    expect(firstPort.disconnect).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('')
  })

  it('does not let a superseded clear erase the input or status of a later verify', async () => {
    let resolveRemove: (() => void) | undefined
    secretStorageMocks.remove.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRemove = resolve
      }),
    )
    platformMocks.runtimeConnect.mockReturnValue(successfulHostPort())
    await import('../../src/options/main')
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('已配置模型 Key（不会回显）'),
    )
    const input = optionsElement<HTMLInputElement>('model-key')
    optionsElement<HTMLButtonElement>('clear-key').click()
    await vi.waitFor(() => expect(secretStorageMocks.remove).toHaveBeenCalledTimes(1))
    input.value = 'd'.repeat(64)
    optionsElement<HTMLButtonElement>('verify-key').click()

    resolveRemove?.()

    await vi.waitFor(() => expect(platformMocks.runtimeConnect).toHaveBeenCalledTimes(1))
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 验证成功并已安全保存'),
    )
    expect(input.value).toBe('')
  })

  it('cancels page-owned verification before closing storage', async () => {
    const hostPort = controlledHostPort()
    platformMocks.runtimeConnect.mockReturnValue(hostPort)
    await import('../../src/options/main')
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('已配置模型 Key（不会回显）'),
    )
    optionsElement<HTMLInputElement>('model-key').value = 'e'.repeat(64)
    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() => expect(hostPort.postMessage).toHaveBeenCalledTimes(1))

    globalThis.dispatchEvent(new Event('pagehide'))

    await vi.waitFor(() => expect(hostPort.disconnect).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(secretStorageMocks.close).toHaveBeenCalledTimes(1))
    expect(optionsElement<HTMLOutputElement>('status').textContent).not.toBe('模型 Key 验证成功并已安全保存')
  })

  it('keeps cancellation and timeout errors distinct and disconnects once', async () => {
    vi.useFakeTimers()
    const timeoutPort = controlledHostPort()
    platformMocks.runtimeConnect.mockReturnValue(timeoutPort)
    const { requestHost } = await import('../../src/options/remote')
    const request = {
      protocol: 'hv-pony-solver/1',
      type: 'verify-key',
      requestId: 'timeout-request',
      candidateKey: 'f'.repeat(64),
    } as const
    const timeoutPromise = requestHost(request, { timeoutMs: 10 })
    const timeoutRejection = expect(timeoutPromise).rejects.toThrow('Key 验证超时')
    await vi.advanceTimersByTimeAsync(10)
    await timeoutRejection
    expect(timeoutPort.disconnect).toHaveBeenCalledTimes(1)

    const abortPort = controlledHostPort()
    platformMocks.runtimeConnect.mockReturnValue(abortPort)
    const controller = new AbortController()
    const abortPromise = requestHost({ ...request, requestId: 'abort-request' }, { signal: controller.signal })
    controller.abort()
    await expect(abortPromise).rejects.toThrow('Key 验证已取消')
    expect(abortPort.disconnect).toHaveBeenCalledTimes(1)
  })

  it('rejects an already-aborted request without opening a Port', async () => {
    const controller = new AbortController()
    controller.abort()
    const { requestHost } = await import('../../src/options/remote')

    await expect(requestHost({
      protocol: 'hv-pony-solver/1',
      type: 'verify-key',
      requestId: 'already-aborted',
      candidateKey: 'a'.repeat(64),
    }, { signal: controller.signal })).rejects.toThrow('Key 验证已取消')
    expect(platformMocks.runtimeConnect).not.toHaveBeenCalled()
  })

  it('ignores unrelated messages and surfaces a matching Host failure', async () => {
    const port = controlledHostPort()
    platformMocks.runtimeConnect.mockReturnValue(port)
    const { requestHost } = await import('../../src/options/remote')
    const request = {
      protocol: 'hv-pony-solver/1',
      type: 'verify-key',
      requestId: 'host-failure',
      candidateKey: 'b'.repeat(64),
    } as const
    const response = requestHost(request)

    port.emitMessage(undefined)
    port.emitMessage({ protocol: 'hv-pony-solver/1', type: 'result', requestId: 'other', ok: true })
    port.emitMessage({
      protocol: 'hv-pony-solver/1',
      type: 'result',
      requestId: request.requestId,
      ok: false,
      error: 'Key 无效',
    })

    await expect(response).rejects.toThrow('Key 无效')
    expect(port.disconnect).toHaveBeenCalledTimes(1)
  })

  it('distinguishes Port disconnect and post failures and cleans up once', async () => {
    const disconnectPort = controlledHostPort()
    platformMocks.runtimeConnect.mockReturnValueOnce(disconnectPort)
    const { requestHost } = await import('../../src/options/remote')
    const request = {
      protocol: 'hv-pony-solver/1',
      type: 'verify-key',
      requestId: 'disconnect',
      candidateKey: 'c'.repeat(64),
    } as const
    const disconnected = requestHost(request)
    disconnectPort.emitDisconnect()
    await expect(disconnected).rejects.toThrow('Key 验证连接已断开')

    const postPort = controlledHostPort()
    postPort.postMessage.mockImplementationOnce(() => {
      throw '发送失败'
    })
    postPort.disconnect.mockImplementationOnce(() => {
      throw new Error('已经断开')
    })
    platformMocks.runtimeConnect.mockReturnValueOnce(postPort)
    await expect(requestHost({ ...request, requestId: 'post-failure' })).rejects.toThrow('发送失败')
    expect(postPort.disconnect).toHaveBeenCalledTimes(1)
  })

  it('shows unconfigured and initial-load failures without exposing a Key', async () => {
    secretStorageMocks.get.mockResolvedValueOnce(null)
    await import('../../src/options/main')
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('尚未配置模型 Key'),
    )

    vi.resetModules()
    installOptionsPageMarkup()
    secretStorageMocks.get.mockRejectedValueOnce(new Error('密钥库读取失败'))
    await import('../../src/options/main')
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('密钥库读取失败'),
    )
  })

  it('validates missing and malformed Keys before contacting the Host', async () => {
    secretStorageMocks.get.mockResolvedValue(null)
    await import('../../src/options/main')
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('尚未配置模型 Key'),
    )

    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('请先输入模型 Key'),
    )
    optionsElement<HTMLInputElement>('model-key').value = 'not-a-key'
    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 必须是 64 位十六进制字符串'),
    )
    expect(platformMocks.runtimeConnect).not.toHaveBeenCalled()
  })

  it('reports the newest clear failure and preserves page-owned state on teardown', async () => {
    secretStorageMocks.remove.mockRejectedValueOnce(new Error('密钥库删除失败'))
    await import('../../src/options/main')
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('已配置模型 Key（不会回显）'),
    )

    optionsElement<HTMLButtonElement>('clear-key').click()
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('密钥库删除失败'),
    )
    globalThis.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(secretStorageMocks.close).toHaveBeenCalledTimes(1))
  })
})
