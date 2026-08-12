import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExtensionPort } from '../../src/platform/webextension'
import type * as WebExtensionModule from '../../src/platform/webextension'

type TestPort = ExtensionPort & Readonly<{
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

  it('rejects timed-out requests and discards late responses', async () => {
    vi.useFakeTimers()
    const panel = statusSink()
    const client = new RemoteDetectorClient(panel)
    const preparePromise = client.prepare()
    const request = vi.mocked(platformMocks.ports[0]!.postMessage).mock.calls[0]![0] as { requestId: string }
    const rejection = expect(preparePromise).rejects.toThrow('扩展推理请求超时')

    await vi.advanceTimersByTimeAsync(95_000)
    await rejection
    platformMocks.ports[0]!.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: true,
    })
    expect(panel.setSessionReady).not.toHaveBeenCalled()
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
})
