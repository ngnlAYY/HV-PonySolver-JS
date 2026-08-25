import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installOptionsPageMarkup, optionsElement } from './options-page-fixture'

type MessageListener = (message: unknown) => void

const platformMocks = vi.hoisted(() => ({
  runtimeConnect: vi.fn(),
  storageGetAll: vi.fn(),
  storageRemove: vi.fn(),
  storageSet: vi.fn(),
}))

vi.mock('../../src/platform/webextension', () => platformMocks)

function successfulHostPort(): Readonly<{
  postMessage: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}> &
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
          protocol: 'hv-pony-solver/2',
          type: 'result',
          requestId: message.requestId,
          ok: true,
        })
      })
    }),
    disconnect: vi.fn(),
  }
}

function controlledHostPort(disconnectError?: string): Readonly<{
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
    ...(disconnectError ? { error: { message: disconnectError } } : {}),
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
  platformMocks.runtimeConnect.mockReset().mockImplementation(() => successfulHostPort())
  platformMocks.storageGetAll.mockReset().mockResolvedValue({})
  platformMocks.storageRemove.mockReset().mockResolvedValue(undefined)
  platformMocks.storageSet.mockReset().mockResolvedValue(undefined)
  installOptionsPageMarkup()
})

afterEach(() => {
  globalThis.dispatchEvent(new Event('pagehide'))
  vi.useRealTimers()
})

describe('default remote options entry', () => {
  it('enables Key controls and sends verify and clear intents without opening secret storage', async () => {
    await import('../../src/options/main')

    expect(optionsElement<HTMLFieldSetElement>('model-key-fieldset').disabled).toBe(false)
    expect(optionsElement<HTMLParagraphElement>('packaged-model-hint').hidden).toBe(true)
    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toContain('不会回显')
    })

    const candidateKey = 'b'.repeat(64)
    optionsElement<HTMLInputElement>('model-key').value = candidateKey
    optionsElement<HTMLButtonElement>('verify-key').click()

    await vi.waitFor(() => expect(platformMocks.runtimeConnect).toHaveBeenCalledTimes(1))
    const verifyPort = platformMocks.runtimeConnect.mock.results[0]?.value as {
      postMessage: ReturnType<typeof vi.fn>
    }
    expect(verifyPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'hv-pony-solver/2',
        type: 'verify-key',
        candidateKey,
      }),
    )
    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 验证成功并已安全保存')
    })

    optionsElement<HTMLButtonElement>('clear-key').click()
    await vi.waitFor(() => expect(platformMocks.runtimeConnect).toHaveBeenCalledTimes(2))
    const clearPort = platformMocks.runtimeConnect.mock.results[1]?.value as {
      postMessage: ReturnType<typeof vi.fn>
    }
    expect(clearPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'hv-pony-solver/2', type: 'clear-key' }),
    )
    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 已清除')
    })
  })

  it('requests model download through the Host without exposing the saved Key to the page', async () => {
    await import('../../src/options/main')

    optionsElement<HTMLButtonElement>('download-model').click()

    await vi.waitFor(() => expect(platformMocks.runtimeConnect).toHaveBeenCalledTimes(1))
    const downloadPort = platformMocks.runtimeConnect.mock.results[0]?.value as {
      postMessage: ReturnType<typeof vi.fn>
    }
    expect(downloadPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'hv-pony-solver/2',
        type: 'download-model',
      }),
    )
    const request = downloadPort.postMessage.mock.calls[0]![0] as Record<string, unknown>
    expect(request).not.toHaveProperty('candidateKey')
    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型下载成功')
    })
  })

  it('requests quota status through the Host without exposing a Key to the page', async () => {
    await import('../../src/options/main')

    optionsElement<HTMLButtonElement>('query-model-quota').click()

    await vi.waitFor(() => expect(platformMocks.runtimeConnect).toHaveBeenCalledTimes(1))
    const quotaPort = platformMocks.runtimeConnect.mock.results[0]?.value as {
      postMessage: ReturnType<typeof vi.fn>
    }
    expect(quotaPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'hv-pony-solver/2',
        type: 'query-model-quota',
      }),
    )
    const request = quotaPort.postMessage.mock.calls[0]![0] as Record<string, unknown>
    expect(request).not.toHaveProperty('candidateKey')
    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型下载次数查询成功')
    })
  })

  it('shows the host notice instead of the default success text when one is returned', async () => {
    const verifyPort = controlledHostPort()
    platformMocks.runtimeConnect.mockReset().mockReturnValue(verifyPort)
    await import('../../src/options/main')
    const input = optionsElement<HTMLInputElement>('model-key')
    input.value = 'c'.repeat(64)
    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() => expect(verifyPort.postMessage).toHaveBeenCalledTimes(1))
    // The pending text must not promise a download the probe no longer performs.
    expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('正在验证模型 Key…')

    const request = verifyPort.postMessage.mock.calls[0]![0] as { requestId: string }
    verifyPort.emitMessage({
      protocol: 'hv-pony-solver/2',
      type: 'result',
      requestId: request.requestId,
      ok: true,
      notice: '模型 Key 有效并已安全保存；本月 5 次模型下载额度已用完，额度恢复后将自动下载模型',
    })

    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe(
        '模型 Key 有效并已安全保存；本月 5 次模型下载额度已用完，额度恢复后将自动下载模型',
      )
    })
    expect(input.value).toBe('')
  })

  it('makes verify then clear latest-operation-wins with no late page mutation', async () => {
    const verifyPort = controlledHostPort()
    const clearPort = successfulHostPort()
    platformMocks.runtimeConnect.mockReset().mockReturnValueOnce(verifyPort).mockReturnValueOnce(clearPort)
    await import('../../src/options/main')
    const input = optionsElement<HTMLInputElement>('model-key')
    input.value = 'b'.repeat(64)
    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() => expect(verifyPort.postMessage).toHaveBeenCalledTimes(1))

    optionsElement<HTMLButtonElement>('clear-key').click()

    await vi.waitFor(() => expect(verifyPort.disconnect).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(clearPort.postMessage).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 已清除'))
    const staleRequest = verifyPort.postMessage.mock.calls[0]![0] as { requestId: string }
    verifyPort.emitMessage({
      protocol: 'hv-pony-solver/2',
      type: 'result',
      requestId: staleRequest.requestId,
      ok: true,
    })
    await Promise.resolve()
    expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 已清除')
    expect(input.value).toBe('')
  })

  it('supersedes an older verification and generates collision-safe intent IDs', async () => {
    const firstPort = controlledHostPort()
    const secondPort = successfulHostPort()
    platformMocks.runtimeConnect.mockReset().mockReturnValueOnce(firstPort).mockReturnValueOnce(secondPort)
    await import('../../src/options/main')
    const input = optionsElement<HTMLInputElement>('model-key')
    input.value = 'b'.repeat(64)
    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() => expect(firstPort.postMessage).toHaveBeenCalledTimes(1))

    input.value = 'c'.repeat(64)
    optionsElement<HTMLButtonElement>('verify-key').click()

    await vi.waitFor(() => expect(secondPort.postMessage).toHaveBeenCalledTimes(1))
    const firstRequest = firstPort.postMessage.mock.calls[0]![0] as { requestId: string }
    const secondRequest = secondPort.postMessage.mock.calls[0]![0] as { requestId: string }
    expect(firstRequest.requestId).not.toBe(secondRequest.requestId)
    expect(firstPort.disconnect).toHaveBeenCalledTimes(1)
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('模型 Key 验证成功并已安全保存'),
    )
  })

  it('cancels a hanging Key operation from the page and stops the port', async () => {
    const verifyPort = controlledHostPort()
    platformMocks.runtimeConnect.mockReset().mockReturnValue(verifyPort)
    await import('../../src/options/main')

    const cancelKeyOperation = optionsElement<HTMLButtonElement>('cancel-key-op')
    expect(cancelKeyOperation.disabled).toBe(true)

    optionsElement<HTMLInputElement>('model-key').value = 'c'.repeat(64)
    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() => {
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('正在验证模型 Key…')
    })
    expect(cancelKeyOperation.disabled).toBe(false)

    cancelKeyOperation.click()
    expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('Key 操作已取消')
    expect(cancelKeyOperation.disabled).toBe(true)
    // The in-flight request is aborted on both sides: the Port is disconnected.
    expect(verifyPort.disconnect).toHaveBeenCalled()

    // The aborted operation must not overwrite the cancellation status later.
    verifyPort.emitDisconnect()
    await Promise.resolve()
    expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('Key 操作已取消')
  })

  it('cancels page-owned verification on pagehide', async () => {
    const hostPort = controlledHostPort()
    platformMocks.runtimeConnect.mockReset().mockReturnValue(hostPort)
    await import('../../src/options/main')
    optionsElement<HTMLInputElement>('model-key').value = 'e'.repeat(64)
    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() => expect(hostPort.postMessage).toHaveBeenCalledTimes(1))

    globalThis.dispatchEvent(new Event('pagehide'))

    await vi.waitFor(() => expect(hostPort.disconnect).toHaveBeenCalledTimes(1))
    expect(optionsElement<HTMLOutputElement>('status').textContent).not.toBe('模型 Key 验证成功并已安全保存')
  })

  it('keeps cancellation and timeout errors distinct for verify and clear intents', async () => {
    vi.useFakeTimers()
    const timeoutPort = controlledHostPort()
    platformMocks.runtimeConnect.mockReset().mockReturnValue(timeoutPort)
    const { requestHost } = await import('../../src/options/remote')
    const verifyRequest = {
      protocol: 'hv-pony-solver/2',
      type: 'verify-key',
      requestId: 'timeout-request',
      candidateKey: 'f'.repeat(64),
    } as const
    const timeoutPromise = requestHost(verifyRequest, { timeoutMs: 10 })
    const timeoutRejection = expect(timeoutPromise).rejects.toThrow('Key 验证超时')
    await vi.advanceTimersByTimeAsync(10)
    await timeoutRejection
    expect(timeoutPort.disconnect).toHaveBeenCalledTimes(1)

    const abortPort = controlledHostPort()
    platformMocks.runtimeConnect.mockReturnValue(abortPort)
    const controller = new AbortController()
    const clearPromise = requestHost(
      { protocol: 'hv-pony-solver/2', type: 'clear-key', requestId: 'abort-clear' },
      { signal: controller.signal },
    )
    controller.abort()
    await expect(clearPromise).rejects.toThrow('Key 清除已取消')
    expect(abortPort.disconnect).toHaveBeenCalledTimes(1)
  })

  it('surfaces the browser-provided reason when a model download Port disconnects', async () => {
    const downloadPort = controlledHostPort('模型下载失败: HTTP 429')
    platformMocks.runtimeConnect.mockReset().mockReturnValue(downloadPort)
    const { requestHost } = await import('../../src/options/remote')
    const downloadPromise = requestHost({
      protocol: 'hv-pony-solver/2',
      type: 'download-model',
      requestId: 'download-disconnect',
    })
    await vi.waitFor(() => expect(downloadPort.postMessage).toHaveBeenCalledTimes(1))

    downloadPort.emitDisconnect()

    await expect(downloadPromise).rejects.toThrow('模型下载失败: HTTP 429')
  })

  it('rejects an already-aborted request without opening a Port', async () => {
    const controller = new AbortController()
    controller.abort()
    const { requestHost } = await import('../../src/options/remote')

    await expect(
      requestHost(
        {
          protocol: 'hv-pony-solver/2',
          type: 'verify-key',
          requestId: 'already-aborted',
          candidateKey: 'a'.repeat(64),
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow('Key 验证已取消')
    expect(platformMocks.runtimeConnect).not.toHaveBeenCalled()
  })

  it('ignores unrelated messages and surfaces a matching Host failure', async () => {
    const port = controlledHostPort()
    platformMocks.runtimeConnect.mockReset().mockReturnValue(port)
    const { requestHost } = await import('../../src/options/remote')
    const request = {
      protocol: 'hv-pony-solver/2',
      type: 'verify-key',
      requestId: 'host-failure',
      candidateKey: 'b'.repeat(64),
    } as const
    const response = requestHost(request)

    port.emitMessage(undefined)
    port.emitMessage({ protocol: 'hv-pony-solver/2', type: 'result', requestId: 'other', ok: true })
    port.emitMessage({
      protocol: 'hv-pony-solver/2',
      type: 'result',
      requestId: request.requestId,
      ok: false,
      error: 'Key 无效',
      errorKind: 'permanent-model',
    })

    await expect(response).rejects.toThrow('Key 无效')
    expect(port.disconnect).toHaveBeenCalledTimes(1)
  })

  it('distinguishes Port disconnect and post failures and cleans up once', async () => {
    const disconnectPort = controlledHostPort()
    platformMocks.runtimeConnect.mockReset().mockReturnValueOnce(disconnectPort)
    const { requestHost } = await import('../../src/options/remote')
    const request = {
      protocol: 'hv-pony-solver/2',
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

  it('validates missing and malformed Keys before contacting the Host', async () => {
    await import('../../src/options/main')

    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('Error: 请先输入模型 Key'),
    )
    optionsElement<HTMLInputElement>('model-key').value = 'not-a-key'
    optionsElement<HTMLButtonElement>('verify-key').click()
    await vi.waitFor(() =>
      expect(optionsElement<HTMLOutputElement>('status').textContent).toBe(
        'Error: 模型 Key 必须是 64 位十六进制字符串',
      ),
    )
    expect(platformMocks.runtimeConnect).not.toHaveBeenCalled()
  })

  it('reports ordinary-settings load failures without reading or exposing a Key', async () => {
    platformMocks.storageGetAll.mockRejectedValueOnce(new Error('设置读取失败'))

    await import('../../src/options/main')

    await vi.waitFor(() => expect(optionsElement<HTMLOutputElement>('status').textContent).toBe('Error: 设置读取失败'))
    expect(platformMocks.runtimeConnect).not.toHaveBeenCalled()
  })
})
