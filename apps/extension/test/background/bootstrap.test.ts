import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostInvoker } from '../../src/background/broker'
import type * as BrokerModule from '../../src/background/broker'
import { InferenceHost } from '../../src/host/inference-host'
import type { RuntimeMessageListener } from '../../src/platform/webextension'
import { OFFSCREEN_MESSAGE_TYPE, PROTOCOL_VERSION, type HostResponse } from '../../src/protocol/messages'

const mocks = vi.hoisted(() => ({
  acquireOffscreenAdmission: vi.fn(),
  addRuntimeMessageListener: vi.fn(),
  closeOffscreenDocumentIfIdle: vi.fn(),
  hasOffscreenDocument: vi.fn(),
  offscreenReleases: [] as Array<ReturnType<typeof vi.fn>>,
  registerBroker: vi.fn(),
  registerOpenOptionsAction: vi.fn(),
  runtimeGetUrl: vi.fn((path: string) => `chrome-extension://extension-id/${path}`),
  runtimeId: vi.fn(() => 'extension-id'),
  sendRuntimeMessage: vi.fn(),
}))

vi.mock('../../src/background/broker', async (importOriginal) => ({
  ...(await importOriginal<typeof BrokerModule>()),
  registerBroker: mocks.registerBroker,
}))
vi.mock('../../src/background/chromium-offscreen', () => ({
  acquireOffscreenAdmission: mocks.acquireOffscreenAdmission,
  closeOffscreenDocumentIfIdle: mocks.closeOffscreenDocumentIfIdle,
  hasOffscreenDocument: mocks.hasOffscreenDocument,
}))
vi.mock('../../src/platform/webextension', () => ({
  addRuntimeMessageListener: mocks.addRuntimeMessageListener,
  registerOpenOptionsAction: mocks.registerOpenOptionsAction,
  runtimeGetUrl: mocks.runtimeGetUrl,
  runtimeId: mocks.runtimeId,
  sendRuntimeMessage: mocks.sendRuntimeMessage,
}))

import { registerChromiumBackground } from '../../src/background/chromium-bootstrap'
import { registerFirefoxBackground } from '../../src/background/firefox-bootstrap'
import {
  MAX_OFFSCREEN_PREPARE_REQUESTS,
  OFFSCREEN_IDLE_TIMEOUT_MS,
  registerOffscreenHost,
} from '../../src/offscreen/offscreen-bootstrap'

const serviceWorkerSender = {
  id: 'extension-id',
  url: 'chrome-extension://extension-id/background.js',
} as const
const offscreenSender = {
  id: 'extension-id',
  url: 'chrome-extension://extension-id/offscreen.html',
} as const

function claim(listener: RuntimeMessageListener, epoch: string): unknown {
  const sendResponse = vi.fn()
  expect(
    listener(
      { type: OFFSCREEN_MESSAGE_TYPE, operation: 'claim', epoch },
      serviceWorkerSender,
      sendResponse,
    ),
  ).toBe(false)
  return sendResponse.mock.calls[0]?.[0]
}

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  mocks.offscreenReleases.length = 0
  mocks.hasOffscreenDocument.mockResolvedValue(false)
  mocks.acquireOffscreenAdmission.mockImplementation(async () => {
    const release = vi.fn()
    mocks.offscreenReleases.push(release)
    return release
  })
  mocks.closeOffscreenDocumentIfIdle.mockResolvedValue(undefined)
  mocks.sendRuntimeMessage.mockImplementation(async (message: Record<string, unknown>) => {
    if (message.operation === 'claim') {
      return {
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'claimed',
        epoch: message.epoch,
        idleGeneration: null,
      }
    }
    if (message.operation === 'confirm-idle') {
      return {
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'idle-confirmed',
        epoch: message.epoch,
        generation: message.generation,
        idle: true,
      }
    }
    if (message.operation === 'request') {
      const request = message.request as { requestId: string }
      return { protocol: PROTOCOL_VERSION, type: 'result', requestId: request.requestId, ok: true }
    }
    return undefined
  })
})

describe('target-specific extension bootstraps', () => {
  it('claims the Offscreen owner before each uniquely identified Chromium request', async () => {
    registerChromiumBackground({ allowOptions: false })
    expect(mocks.registerBroker).toHaveBeenCalledWith(expect.any(Function), { allowOptions: false })
    expect(mocks.registerOpenOptionsAction).toHaveBeenCalledTimes(1)
    const invokeHost = mocks.registerBroker.mock.calls[0]![0] as HostInvoker

    await expect(
      invokeHost({ protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-1' }, new AbortController().signal),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      invokeHost({ protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-2' }, new AbortController().signal),
    ).resolves.toMatchObject({ ok: true })

    const sentRequests = mocks.sendRuntimeMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .filter((message) => message.operation === 'request')
    const claims = mocks.sendRuntimeMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .filter((message) => message.operation === 'claim')
    expect(sentRequests).toHaveLength(2)
    expect(claims).toHaveLength(2)
    expect(sentRequests[0]).toMatchObject({
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'request',
      epoch: claims[0]!.epoch,
      requestId: expect.stringMatching(/^sw-/),
      request: expect.objectContaining({ requestId: 'prepare-1' }),
    })
    expect(sentRequests[0]!.requestId).not.toBe(sentRequests[1]!.requestId)
    expect(mocks.offscreenReleases.every((release) => release.mock.calls.length === 1)).toBe(true)
  })

  it('propagates caller cancellation with the same epoch and ignores a late response', async () => {
    registerChromiumBackground()
    const invokeHost = mocks.registerBroker.mock.calls[0]![0] as HostInvoker
    let resolveResponse: ((response: HostResponse) => void) | undefined
    mocks.sendRuntimeMessage.mockImplementation((message: Record<string, unknown>) => {
      if (message.operation === 'claim') {
        return Promise.resolve({
          type: OFFSCREEN_MESSAGE_TYPE,
          operation: 'claimed',
          epoch: message.epoch,
          idleGeneration: null,
        })
      }
      if (message.operation === 'cancel') {
        return Promise.resolve(undefined)
      }
      return new Promise<HostResponse>((resolve) => {
        resolveResponse = resolve
      })
    })
    const controller = new AbortController()
    const invocation = invokeHost(
      { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-cancel' },
      controller.signal,
    )
    await vi.waitFor(() =>
      expect(
        mocks.sendRuntimeMessage.mock.calls.some(([message]) => (message as { operation?: string }).operation === 'request'),
      ).toBe(true),
    )
    const requestMessage = mocks.sendRuntimeMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .find((message) => message.operation === 'request')!

    controller.abort()

    await expect(invocation).rejects.toThrow('推理请求已取消')
    expect(mocks.sendRuntimeMessage).toHaveBeenCalledWith({
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'cancel',
      epoch: requestMessage.epoch,
      requestId: requestMessage.requestId,
    })
    expect(mocks.offscreenReleases[0]).toHaveBeenCalledTimes(1)

    resolveResponse?.({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'prepare-cancel',
      ok: true,
    })
  })

  it('claims a surviving Offscreen document without creating one and restores its status snapshot', async () => {
    const broadcastContentStatus = vi.fn()
    mocks.registerBroker.mockReturnValue({ dispose: vi.fn(), broadcastContentStatus })
    mocks.hasOffscreenDocument.mockResolvedValue(true)
    mocks.sendRuntimeMessage.mockImplementation(async (message: Record<string, unknown>) => ({
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'claimed',
      epoch: message.epoch,
      idleGeneration: 7,
      status: { session: '已就绪 123ms' },
    }))

    registerChromiumBackground()

    await vi.waitFor(() => expect(broadcastContentStatus).toHaveBeenCalledWith({ session: '已就绪 123ms' }))
    expect(mocks.acquireOffscreenAdmission).not.toHaveBeenCalled()
  })

  it('registers Firefox with the injected long-lived Host and policy', async () => {
    const host = {
      handle: vi.fn(async () => ({
        protocol: PROTOCOL_VERSION,
        type: 'result' as const,
        requestId: 'prepare-firefox',
        ok: true as const,
      })),
      destroy: vi.fn(),
    }
    registerFirefoxBackground(() => host as never, { allowOptions: false })
    const invokeHost = mocks.registerBroker.mock.calls[0]![0] as HostInvoker
    const signal = new AbortController().signal

    await invokeHost({ protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-firefox' }, signal)

    expect(host.handle).toHaveBeenCalledWith(
      { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-firefox' },
      signal,
    )
    expect(mocks.registerBroker).toHaveBeenCalledWith(expect.any(Function), { allowOptions: false })
  })

  it('keeps newest-Key-intent arbitration in the shared Firefox Host', async () => {
    let resolveVerification: (() => void) | undefined
    const commits: string[] = []
    const detector = {
      prepare: vi.fn(async () => undefined),
      detect: vi.fn(),
      destroy: vi.fn(),
    }
    const host = new InferenceHost({
      detector: detector as never,
      verifyKey: vi.fn(async (_candidateKey, signal) => {
        await new Promise<void>((resolve) => {
          resolveVerification = resolve
        })
        if (!signal.aborted) {
          commits.push('verify')
        }
        return undefined
      }),
      clearKey: vi.fn(async () => {
        commits.push('clear')
      }),
    })
    registerFirefoxBackground(() => host)
    const invokeHost = mocks.registerBroker.mock.calls[0]![0] as HostInvoker
    const stale = invokeHost(
      {
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: 'firefox-stale',
        candidateKey: 'a'.repeat(64),
      },
      new AbortController().signal,
    )
    await vi.waitFor(() => expect(resolveVerification).toBeTypeOf('function'))
    const clear = invokeHost(
      { protocol: PROTOCOL_VERSION, type: 'clear-key', requestId: 'firefox-clear' },
      new AbortController().signal,
    )

    resolveVerification?.()

    await expect(stale).resolves.toMatchObject({ ok: false })
    await expect(clear).resolves.toMatchObject({ ok: true })
    expect(commits).toEqual(['clear'])
  })

  it('cancels orphaned old-epoch work when a new service worker claims ownership', async () => {
    let oldSignal: AbortSignal | undefined
    let resolveOld: ((response: HostResponse) => void) | undefined
    const host = {
      handle: vi
        .fn()
        .mockImplementationOnce(
          (_request: unknown, signal: AbortSignal) =>
            new Promise<HostResponse>((resolve) => {
              oldSignal = signal
              resolveOld = resolve
            }),
        )
        .mockResolvedValueOnce({
          protocol: PROTOCOL_VERSION,
          type: 'result',
          requestId: 'prepare-new',
          ok: true,
        }),
      destroy: vi.fn(),
    }
    registerOffscreenHost(() => host as never)
    const listener = mocks.addRuntimeMessageListener.mock.calls[0]![0] as RuntimeMessageListener
    claim(listener, 'epoch-old')
    const oldResponse = vi.fn()
    expect(
      listener(
        {
          type: OFFSCREEN_MESSAGE_TYPE,
          operation: 'request',
          epoch: 'epoch-old',
          requestId: 'offscreen-old',
          request: { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-old' },
        },
        serviceWorkerSender,
        oldResponse,
      ),
    ).toBe(true)
    await vi.waitFor(() => expect(oldSignal).toBeInstanceOf(AbortSignal))

    claim(listener, 'epoch-new')
    expect(oldSignal?.aborted).toBe(true)
    const staleResponse = vi.fn()
    expect(
      listener(
        {
          type: OFFSCREEN_MESSAGE_TYPE,
          operation: 'request',
          epoch: 'epoch-old',
          requestId: 'offscreen-stale',
          request: { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-stale' },
        },
        serviceWorkerSender,
        staleResponse,
      ),
    ).toBe(false)
    expect(staleResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))

    resolveOld?.({ protocol: PROTOCOL_VERSION, type: 'result', requestId: 'prepare-old', ok: true })
    await vi.waitFor(() => expect(oldResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false })))

    const newResponse = vi.fn()
    expect(
      listener(
        {
          type: OFFSCREEN_MESSAGE_TYPE,
          operation: 'request',
          epoch: 'epoch-new',
          requestId: 'offscreen-new',
          request: { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-new' },
        },
        serviceWorkerSender,
        newResponse,
      ),
    ).toBe(true)
    await vi.waitFor(() => expect(newResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true })))
  })

  it('enforces final Offscreen concurrency limits after Broker admission', async () => {
    const host = {
      handle: vi.fn(() => new Promise<HostResponse>(() => undefined)),
      destroy: vi.fn(),
    }
    registerOffscreenHost(() => host as never)
    const listener = mocks.addRuntimeMessageListener.mock.calls[0]![0] as RuntimeMessageListener
    claim(listener, 'epoch-capacity')

    for (let index = 0; index < MAX_OFFSCREEN_PREPARE_REQUESTS; index += 1) {
      expect(
        listener(
          {
            type: OFFSCREEN_MESSAGE_TYPE,
            operation: 'request',
            epoch: 'epoch-capacity',
            requestId: `offscreen-${index}`,
            request: { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: `prepare-${index}` },
          },
          serviceWorkerSender,
          vi.fn(),
        ),
      ).toBe(true)
    }
    const overflowResponse = vi.fn()
    expect(
      listener(
        {
          type: OFFSCREEN_MESSAGE_TYPE,
          operation: 'request',
          epoch: 'epoch-capacity',
          requestId: 'offscreen-overflow',
          request: { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-overflow' },
        },
        serviceWorkerSender,
        overflowResponse,
      ),
    ).toBe(false)
    await vi.waitFor(() => expect(host.handle).toHaveBeenCalledTimes(MAX_OFFSCREEN_PREPARE_REQUESTS))
    expect(overflowResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: expect.stringContaining('繁忙') }),
    )
  })

  it('starts warm-idle only after Host activity settles and confirms the generation', async () => {
    vi.useFakeTimers()
    const host = {
      handle: vi.fn(async (): Promise<HostResponse> => ({
        protocol: PROTOCOL_VERSION,
        type: 'result',
        requestId: 'prepare-idle',
        ok: true,
      })),
      destroy: vi.fn(),
    }
    registerOffscreenHost(() => host as never)
    const listener = mocks.addRuntimeMessageListener.mock.calls[0]![0] as RuntimeMessageListener
    claim(listener, 'epoch-idle')
    const sendResponse = vi.fn()
    listener(
      {
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'request',
        epoch: 'epoch-idle',
        requestId: 'offscreen-idle',
        request: { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-idle' },
      },
      serviceWorkerSender,
      sendResponse,
    )
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled())
    mocks.sendRuntimeMessage.mockClear()

    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_TIMEOUT_MS)

    const idleMessage = mocks.sendRuntimeMessage.mock.calls[0]?.[0] as Record<string, unknown>
    expect(idleMessage).toMatchObject({
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'idle',
      epoch: 'epoch-idle',
      generation: expect.any(Number),
    })
    const confirmation = vi.fn()
    expect(
      listener(
        {
          type: OFFSCREEN_MESSAGE_TYPE,
          operation: 'confirm-idle',
          epoch: 'epoch-idle',
          generation: idleMessage.generation,
        },
        serviceWorkerSender,
        confirmation,
      ),
    ).toBe(false)
    expect(confirmation).toHaveBeenCalledWith(expect.objectContaining({ idle: true }))
  })

  it('re-arms warm idle when a new epoch claims inside the previous warm window', async () => {
    vi.useFakeTimers()
    const host = {
      handle: vi.fn(async (): Promise<HostResponse> => ({
        protocol: PROTOCOL_VERSION,
        type: 'result',
        requestId: 'prepare-rearm',
        ok: true,
      })),
      destroy: vi.fn(),
    }
    registerOffscreenHost(() => host as never)
    const listener = mocks.addRuntimeMessageListener.mock.calls[0]![0] as RuntimeMessageListener
    claim(listener, 'epoch-warm-old')
    const sendResponse = vi.fn()
    listener(
      {
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'request',
        epoch: 'epoch-warm-old',
        requestId: 'offscreen-rearm',
        request: { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-rearm' },
      },
      serviceWorkerSender,
      sendResponse,
    )
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled())
    mocks.sendRuntimeMessage.mockClear()

    claim(listener, 'epoch-warm-new')
    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_TIMEOUT_MS)

    const idleMessage = mocks.sendRuntimeMessage.mock.calls[0]?.[0] as Record<string, unknown>
    expect(idleMessage).toMatchObject({
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'idle',
      epoch: 'epoch-warm-new',
      generation: expect.any(Number),
    })
  })

  it('sends status only for the claimed epoch and validates the exact service-worker sender URL', () => {
    let emit: ((status: { model?: string; session?: string }) => void) | undefined
    registerOffscreenHost((emitStatus) => {
      emit = emitStatus
      return { handle: vi.fn(), destroy: vi.fn() } as never
    })
    const listener = mocks.addRuntimeMessageListener.mock.calls[0]![0] as RuntimeMessageListener
    expect(
      listener(
        { type: OFFSCREEN_MESSAGE_TYPE, operation: 'claim', epoch: 'epoch-status' },
        { id: 'extension-id', url: 'chrome-extension://extension-id/not-background.js' },
        vi.fn(),
      ),
    ).toBe(false)
    emit?.({ model: 'ignored' })
    expect(mocks.sendRuntimeMessage).not.toHaveBeenCalled()

    claim(listener, 'epoch-status')
    emit?.({ model: '下载中' })

    expect(mocks.sendRuntimeMessage).toHaveBeenCalledWith({
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'status',
      epoch: 'epoch-status',
      status: { model: '下载中' },
    })
  })

  it('relays current-epoch status and performs two-phase idle confirmation', async () => {
    const broadcastContentStatus = vi.fn()
    mocks.registerBroker.mockReturnValue({ dispose: vi.fn(), broadcastContentStatus })
    mocks.hasOffscreenDocument.mockResolvedValue(true)
    registerChromiumBackground()
    await vi.waitFor(() =>
      expect(
        mocks.sendRuntimeMessage.mock.calls.some(([message]) => (message as { operation?: string }).operation === 'claim'),
      ).toBe(true),
    )
    const claimMessage = mocks.sendRuntimeMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .find((message) => message.operation === 'claim')!
    const relay = mocks.addRuntimeMessageListener.mock.calls.at(-1)![0] as RuntimeMessageListener

    expect(
      relay(
        {
          type: OFFSCREEN_MESSAGE_TYPE,
          operation: 'status',
          epoch: claimMessage.epoch,
          status: { model: '下载中' },
        },
        offscreenSender,
        vi.fn(),
      ),
    ).toBe(false)
    expect(broadcastContentStatus).toHaveBeenCalledWith({ model: '下载中' })

    relay(
      {
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'idle',
        epoch: 'old-epoch-wakeup',
        generation: 9,
      },
      offscreenSender,
      vi.fn(),
    )
    expect(mocks.closeOffscreenDocumentIfIdle).toHaveBeenCalledTimes(1)
    const confirmIdle = mocks.closeOffscreenDocumentIfIdle.mock.calls[0]![0] as () => Promise<boolean>
    await expect(confirmIdle()).resolves.toBe(true)
    expect(mocks.sendRuntimeMessage).toHaveBeenCalledWith({
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'confirm-idle',
      epoch: claimMessage.epoch,
      generation: 9,
    })

    relay(
      {
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'status',
        epoch: claimMessage.epoch,
        status: { model: 'x' },
      },
      { id: 'extension-id', url: 'chrome-extension://extension-id/not-offscreen.html' },
      vi.fn(),
    )
    expect(broadcastContentStatus).toHaveBeenCalledTimes(1)
  })

  it('wires the Firefox Host status emitter to the broker broadcast', () => {
    const broadcastContentStatus = vi.fn()
    mocks.registerBroker.mockImplementation(() => ({ dispose: vi.fn(), broadcastContentStatus }))
    let emit: ((status: { model?: string; session?: string }) => void) | undefined
    const host = { handle: vi.fn(), destroy: vi.fn() }

    registerFirefoxBackground((emitStatus) => {
      emit = emitStatus
      return host as never
    })

    emit?.({ session: '初始化中' })
    expect(broadcastContentStatus).toHaveBeenCalledWith({ session: '初始化中' })
  })
})
