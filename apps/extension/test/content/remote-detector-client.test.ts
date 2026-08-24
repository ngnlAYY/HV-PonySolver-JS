import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareDeadlineConfig } from '@hv-pony-solver/browser-core/inference/inference-config'
import { isPermanentModelError } from '@hv-pony-solver/browser-core/model/permanent-model-error'
import type { ExtensionPort } from '../../src/platform/webextension'
import type * as WebExtensionModule from '../../src/platform/webextension'

type TestPort = ExtensionPort &
  Readonly<{
    emitMessage(message: unknown): void
    emitDisconnect(): void
  }>

const platformMocks = vi.hoisted(() => ({
  ports: [] as TestPort[],
  runtimeConnect: vi.fn(),
}))

vi.mock('../../src/platform/webextension', async (importOriginal) => {
  const actual = await importOriginal<typeof WebExtensionModule>()
  return { ...actual, runtimeConnect: platformMocks.runtimeConnect }
})

import { RemoteDetectorClient } from '../../src/content/remote-detector-client'
import { PREFETCH_MISS_STORAGE_KEY } from '../../src/content/prefetch'
import { PROTOCOL_VERSION } from '../../src/protocol/messages'

function createPort(): TestPort {
  let messageListener: ((message: unknown) => void) | undefined
  let disconnectListener: (() => void) | undefined
  return {
    name: 'hv-pony-solver:content',
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => void) => {
        messageListener = listener
      }),
      removeListener: vi.fn(),
    },
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => {
        disconnectListener = listener
      }),
      removeListener: vi.fn(),
    },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    emitMessage: (message) => messageListener?.(message),
    emitDisconnect: () => disconnectListener?.(),
  }
}

function statusSink() {
  return {
    setStatus: vi.fn(),
    setSessionReady: vi.fn(),
  }
}

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  platformMocks.ports.length = 0
  platformMocks.runtimeConnect.mockImplementation(() => {
    const port = createPort()
    platformMocks.ports.push(port)
    return port
  })
})

describe('RemoteDetectorClient', () => {
  it('ignores stale responses and resolves the matching JSON-safe detection result', async () => {
    const client = new RemoteDetectorClient(statusSink())
    const detectPromise = client.detect(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
    await vi.waitFor(() => expect(platformMocks.ports[0]?.postMessage).toHaveBeenCalledTimes(1))
    const request = vi.mocked(platformMocks.ports[0]!.postMessage).mock.calls[0]![0] as { requestId: string }
    const resolved = vi.fn()
    void detectPromise.then(resolved)

    platformMocks.ports[0]!.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'stale-request',
      ok: true,
    })
    await Promise.resolve()
    expect(resolved).not.toHaveBeenCalled()

    const result = {
      success: true,
      ponies: ['TS'],
      confidences: { TS: 0.92 },
      detections: [{ class_id: 0, confidence: 0.92 }],
      candidates: [{ class_id: 0, confidence: 0.92 }],
    }
    platformMocks.ports[0]!.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: true,
      result,
    })

    await expect(detectPromise).resolves.toEqual(result)
  })

  it('prepares silently without touching the status panel', async () => {
    const sink = statusSink()
    const client = new RemoteDetectorClient(sink)
    const preparePromise = client.prepare(undefined, { silent: true })
    await vi.waitFor(() => expect(platformMocks.ports[0]?.postMessage).toHaveBeenCalledTimes(1))
    const request = vi.mocked(platformMocks.ports[0]!.postMessage).mock.calls[0]![0] as { requestId: string }
    platformMocks.ports[0]!.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: true,
    })

    await expect(preparePromise).resolves.toBeUndefined()
    expect(sink.setStatus).not.toHaveBeenCalled()
    expect(sink.setSessionReady).not.toHaveBeenCalled()
  })

  it('keeps a silent failed prepare out of the status panel', async () => {
    const sink = statusSink()
    const client = new RemoteDetectorClient(sink)
    const preparePromise = client.prepare(undefined, { silent: true })
    await vi.waitFor(() => expect(platformMocks.ports[0]?.postMessage).toHaveBeenCalledTimes(1))
    const request = vi.mocked(platformMocks.ports[0]!.postMessage).mock.calls[0]![0] as { requestId: string }
    platformMocks.ports[0]!.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: false,
      error: '离线',
      errorKind: 'transient',
    })

    await expect(preparePromise).rejects.toThrow('离线')
    expect(sink.setStatus).not.toHaveBeenCalled()
  })

  it('keeps the Port alive when a cancel post fails so sibling requests still settle', async () => {
    vi.useFakeTimers()
    const client = new RemoteDetectorClient(statusSink())
    const detectPromise = client.detect(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    await vi.waitFor(() => expect(platformMocks.ports[0]?.postMessage).toHaveBeenCalledTimes(1))
    const port = platformMocks.ports[0]!
    vi.mocked(port.postMessage).mockImplementation(() => {
      throw new Error('port closed')
    })

    const rejection = expect(detectPromise).rejects.toThrow('扩展推理请求超时')
    await vi.advanceTimersByTimeAsync(35_000)
    await rejection
    expect(port.disconnect).not.toHaveBeenCalled()
  })

  it('rejects timed-out requests, cancels them remotely, and keeps the Port for later work', async () => {
    vi.useFakeTimers()
    const panel = statusSink()
    const client = new RemoteDetectorClient(panel)
    const preparePromise = client.prepare()
    const port = platformMocks.ports[0]!
    const request = vi.mocked(port.postMessage).mock.calls[0]![0] as { requestId: string }
    const rejection = expect(preparePromise).rejects.toThrow('扩展推理请求超时')

    await vi.advanceTimersByTimeAsync(prepareDeadlineConfig.contentTimeoutMs)
    await rejection
    expect(port.disconnect).not.toHaveBeenCalled()
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cancel', cancelRequestId: request.requestId }),
    )
    port.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: true,
    })
    expect(panel.setSessionReady).not.toHaveBeenCalled()

    const nextPrepare = client.prepare()
    expect(platformMocks.ports).toHaveLength(1)
    const nextRequest = vi.mocked(port.postMessage).mock.lastCall?.[0] as { requestId: string }
    port.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: nextRequest.requestId,
      ok: true,
    })
    await expect(nextPrepare).resolves.toBeUndefined()
  })

  it('accepts a legal Worker preparation that completes after the former 95-second client deadline', async () => {
    vi.useFakeTimers()
    const panel = statusSink()
    const client = new RemoteDetectorClient(panel)
    const preparePromise = client.prepare()
    const port = platformMocks.ports[0]!
    const request = vi.mocked(port.postMessage).mock.calls[0]![0] as { requestId: string }

    await vi.advanceTimersByTimeAsync(99_000)
    expect(port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'cancel' }))
    port.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: true,
    })

    await expect(preparePromise).resolves.toBeUndefined()
    expect(panel.setSessionReady).toHaveBeenCalledTimes(1)
  })

  it('keeps sibling requests alive when one request is abandoned on the same Port', async () => {
    const client = new RemoteDetectorClient(statusSink())
    const slowController = new AbortController()
    const slow = client.detect(new Blob([new Uint8Array([1])], { type: 'image/png' }), slowController.signal)
    const fast = client.detect(new Blob([new Uint8Array([2])], { type: 'image/png' }))
    await vi.waitFor(() => expect(platformMocks.ports[0]?.postMessage).toHaveBeenCalledTimes(2))
    const port = platformMocks.ports[0]!
    const slowRequest = vi.mocked(port.postMessage).mock.calls[0]![0] as { requestId: string }
    const fastRequest = vi.mocked(port.postMessage).mock.calls[1]![0] as { requestId: string }

    slowController.abort()
    await expect(slow).rejects.toThrow('推理请求已取消')
    expect(port.disconnect).not.toHaveBeenCalled()
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cancel', cancelRequestId: slowRequest.requestId }),
    )

    const result = {
      success: true,
      ponies: ['TS'],
      confidences: { TS: 0.92 },
      detections: [{ class_id: 0, confidence: 0.92 }],
      candidates: [{ class_id: 0, confidence: 0.92 }],
    }
    port.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: fastRequest.requestId,
      ok: true,
      result,
    })
    await expect(fast).resolves.toEqual(result)
  })

  it('renders Host stage status updates without settling pending requests', async () => {
    const panel = statusSink()
    const client = new RemoteDetectorClient(panel)
    const preparePromise = client.prepare()
    const port = platformMocks.ports[0]!
    const request = vi.mocked(port.postMessage).mock.calls[0]![0] as { requestId: string }

    port.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'status',
      status: { model: '下载中', session: '初始化中' },
    })
    expect(panel.setStatus).toHaveBeenCalledWith({ model: '下载中', session: '初始化中' })

    port.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: true,
    })
    await expect(preparePromise).resolves.toBeUndefined()
  })

  it('forwards only strict model-credentials change controls without settling requests', async () => {
    const onModelCredentialsChanged = vi.fn()
    const client = new RemoteDetectorClient(statusSink(), onModelCredentialsChanged)
    const preparePromise = client.prepare()
    const port = platformMocks.ports[0]!
    const request = vi.mocked(port.postMessage).mock.calls[0]![0] as { requestId: string }

    port.emitMessage({ protocol: PROTOCOL_VERSION, type: 'model-credentials-changed', extra: true })
    expect(onModelCredentialsChanged).not.toHaveBeenCalled()
    port.emitMessage({ protocol: PROTOCOL_VERSION, type: 'model-credentials-changed' })
    expect(onModelCredentialsChanged).toHaveBeenCalledTimes(1)

    port.emitMessage({ protocol: PROTOCOL_VERSION, type: 'result', requestId: request.requestId, ok: true })
    await expect(preparePromise).resolves.toBeUndefined()
  })

  it('rejects on disconnect and reconnects lazily for the next request', async () => {
    const panel = statusSink()
    const client = new RemoteDetectorClient(panel)
    const firstPrepare = client.prepare()
    platformMocks.ports[0]!.emitDisconnect()
    await expect(firstPrepare).rejects.toThrow('扩展推理连接已断开')

    const nextPrepare = client.prepare()
    expect(platformMocks.ports).toHaveLength(2)
    const nextRequest = vi.mocked(platformMocks.ports[1]!.postMessage).mock.calls[0]![0] as { requestId: string }
    platformMocks.ports[1]!.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: nextRequest.requestId,
      ok: true,
    })

    await expect(nextPrepare).resolves.toBeUndefined()
    expect(panel.setSessionReady).toHaveBeenCalledTimes(1)
  })

  it('cancels only the aborted request and keeps the Port for later work', async () => {
    const client = new RemoteDetectorClient(statusSink())
    const controller = new AbortController()
    const firstPrepare = client.prepare(controller.signal)
    controller.abort()
    const port = platformMocks.ports[0]!

    await expect(firstPrepare).rejects.toThrow('推理请求已取消')
    expect(port.disconnect).not.toHaveBeenCalled()
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'cancel' }))

    const nextPrepare = client.prepare()
    expect(platformMocks.ports).toHaveLength(1)
    const nextRequest = vi.mocked(port.postMessage).mock.lastCall?.[0] as { requestId: string }
    port.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: nextRequest.requestId,
      ok: true,
    })
    await expect(nextPrepare).resolves.toBeUndefined()
  })

  it('rejects host failures, ignores malformed messages, and marks prepare as failed', async () => {
    const panel = statusSink()
    const client = new RemoteDetectorClient(panel)
    const preparePromise = client.prepare()
    const port = platformMocks.ports[0]!
    const request = vi.mocked(port.postMessage).mock.calls[0]![0] as { requestId: string }

    port.emitMessage(null)
    port.emitMessage({ protocol: PROTOCOL_VERSION, type: 'result', requestId: 'other', ok: true })
    port.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: false,
      error: '模型不可用',
      errorKind: 'transient',
    })

    await expect(preparePromise).rejects.toThrow('模型不可用')
    expect(panel.setStatus).toHaveBeenLastCalledWith({ session: '错误' })
  })

  it('reconstructs only allowlisted permanent model failures across the Port boundary', async () => {
    const client = new RemoteDetectorClient(statusSink())
    const preparePromise = client.prepare()
    const port = platformMocks.ports[0]!
    const request = vi.mocked(port.postMessage).mock.calls[0]![0] as { requestId: string }

    port.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: false,
      error: '模型 Key 无效或已失效，请在设置中重新验证 Key',
      errorKind: 'permanent-model',
    })

    const error = await preparePromise.catch((caught: unknown) => caught)
    expect(isPermanentModelError(error)).toBe(true)
    expect(error).toMatchObject({ userMessage: '模型 Key 无效或已失效，请在设置中重新验证 Key' })
  })

  it('clears the prefetch idle-backoff budget as soon as a real detect starts', async () => {
    globalThis.sessionStorage.setItem(PREFETCH_MISS_STORAGE_KEY, '3')
    const client = new RemoteDetectorClient(statusSink())
    const detectPromise = client.detect(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    await vi.waitFor(() => expect(platformMocks.ports[0]?.postMessage).toHaveBeenCalledTimes(1))
    expect(globalThis.sessionStorage.getItem(PREFETCH_MISS_STORAGE_KEY)).toBeNull()

    const request = vi.mocked(platformMocks.ports[0]!.postMessage).mock.calls[0]![0] as { requestId: string }
    platformMocks.ports[0]!.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: true,
    })
    await expect(detectPromise).rejects.toThrow('扩展推理 Host 未返回识别结果')
  })

  it('reports image encoding failures and rejects successful detections without a result', async () => {
    const client = new RemoteDetectorClient(statusSink())

    await expect(client.detect(new Blob([], { type: 'image/png' }))).rejects.toThrow('验证码图片编码失败')
    expect(platformMocks.runtimeConnect).not.toHaveBeenCalled()

    const detectPromise = client.detect(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    await vi.waitFor(() => expect(platformMocks.ports[0]?.postMessage).toHaveBeenCalledTimes(1))
    const request = vi.mocked(platformMocks.ports[0]!.postMessage).mock.calls[0]![0] as { requestId: string }
    platformMocks.ports[0]!.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: true,
    })

    await expect(detectPromise).rejects.toThrow('扩展推理 Host 未返回识别结果')
  })

  it('normalizes connection and post failures and ignores stale disconnect callbacks', async () => {
    const panel = statusSink()
    const client = new RemoteDetectorClient(panel)
    platformMocks.runtimeConnect.mockImplementationOnce(() => {
      throw '连接初始化失败'
    })
    await expect(client.prepare()).rejects.toThrow('连接初始化失败')

    platformMocks.runtimeConnect.mockImplementationOnce(() => {
      const port = createPort()
      vi.mocked(port.postMessage).mockImplementationOnce(() => {
        throw new Error('发送失败')
      })
      platformMocks.ports.push(port)
      return port
    })
    await expect(client.prepare()).rejects.toThrow('发送失败')
    const stalePort = platformMocks.ports[0]!
    expect(stalePort.disconnect).toHaveBeenCalledTimes(1)
    stalePort.emitDisconnect()
    expect(panel.setStatus).toHaveBeenLastCalledWith({ session: '错误' })
  })

  it('makes destroy idempotent, rejects pending and future work, and tolerates disconnect errors', async () => {
    platformMocks.runtimeConnect.mockImplementationOnce(() => {
      const port = createPort()
      vi.mocked(port.disconnect).mockImplementationOnce(() => {
        throw new Error('已经断开')
      })
      platformMocks.ports.push(port)
      return port
    })
    const panel = statusSink()
    const client = new RemoteDetectorClient(panel)
    const pending = client.prepare()

    client.destroy()
    client.destroy()

    await expect(pending).rejects.toThrow('扩展推理连接已关闭')
    await expect(client.prepare()).rejects.toThrow('扩展推理连接已关闭')
    expect(platformMocks.ports[0]!.disconnect).toHaveBeenCalledTimes(1)
    expect(panel.setSessionReady).not.toHaveBeenCalled()
  })

  it('closes the abort-listener race after publishing a pending request', async () => {
    const controller = new AbortController()
    const originalAddEventListener = controller.signal.addEventListener.bind(controller.signal)
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation((...args) => {
      originalAddEventListener(...args)
      controller.abort()
    })
    const client = new RemoteDetectorClient(statusSink())

    await expect(client.prepare(controller.signal)).rejects.toThrow('推理请求已取消')
    // The request was never posted, so no cancel must be sent for it.
    expect(platformMocks.ports[0]!.postMessage).not.toHaveBeenCalled()
    expect(platformMocks.ports[0]!.disconnect).not.toHaveBeenCalled()
  })
})
