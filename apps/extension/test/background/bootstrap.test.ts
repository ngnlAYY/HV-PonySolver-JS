import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostInvoker } from '../../src/background/broker'
import type * as BrokerModule from '../../src/background/broker'
import { InferenceHost } from '../../src/host/inference-host'
import type { RuntimeMessageListener } from '../../src/platform/webextension'
import { OFFSCREEN_MESSAGE_TYPE, PROTOCOL_VERSION, type HostResponse } from '../../src/protocol/messages'

const mocks = vi.hoisted(() => ({
  acquireOffscreenDocument: vi.fn(),
  addRuntimeMessageListener: vi.fn(),
  offscreenReleases: [] as Array<ReturnType<typeof vi.fn>>,
  registerBroker: vi.fn(),
  registerOpenOptionsAction: vi.fn(),
  runtimeId: vi.fn(() => 'extension-id'),
  sendRuntimeMessage: vi.fn(),
}))

vi.mock('../../src/background/broker', async (importOriginal) => ({
  ...(await importOriginal<typeof BrokerModule>()),
  registerBroker: mocks.registerBroker,
}))
vi.mock('../../src/background/chromium-offscreen', () => ({
  acquireOffscreenDocument: mocks.acquireOffscreenDocument,
}))
vi.mock('../../src/platform/webextension', () => ({
  addRuntimeMessageListener: mocks.addRuntimeMessageListener,
  registerOpenOptionsAction: mocks.registerOpenOptionsAction,
  runtimeId: mocks.runtimeId,
  sendRuntimeMessage: mocks.sendRuntimeMessage,
}))

import { registerChromiumBackground } from '../../src/background/chromium-bootstrap'
import { registerFirefoxBackground } from '../../src/background/firefox-bootstrap'
import { registerOffscreenHost } from '../../src/offscreen/offscreen-bootstrap'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.offscreenReleases.length = 0
  mocks.acquireOffscreenDocument.mockImplementation(async () => {
    const release = vi.fn()
    mocks.offscreenReleases.push(release)
    return release
  })
})

describe('target-specific extension bootstraps', () => {
  it('sends Chromium requests with unique stable offscreen IDs and releases each lease', async () => {
    registerChromiumBackground({ allowOptions: false })
    expect(mocks.registerBroker).toHaveBeenCalledWith(expect.any(Function), { allowOptions: false })
    expect(mocks.registerOpenOptionsAction).toHaveBeenCalledTimes(1)
    const invokeHost = mocks.registerBroker.mock.calls[0]![0] as HostInvoker
    mocks.sendRuntimeMessage.mockImplementation(
      async (message: { operation: string; request?: { requestId: string } }) => ({
        protocol: PROTOCOL_VERSION,
        type: 'result',
        requestId: message.request!.requestId,
        ok: true,
      }),
    )

    await expect(
      invokeHost({ protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-1' }, new AbortController().signal),
    ).resolves.toMatchObject({ ok: true })
    await expect(
      invokeHost({ protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-2' }, new AbortController().signal),
    ).resolves.toMatchObject({ ok: true })

    const sentRequests = mocks.sendRuntimeMessage.mock.calls.map(([message]) => message as Record<string, unknown>)
    expect(sentRequests).toEqual([
      expect.objectContaining({
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'request',
        requestId: expect.stringMatching(/^sw-/),
        request: expect.objectContaining({ requestId: 'prepare-1' }),
      }),
      expect.objectContaining({
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'request',
        requestId: expect.stringMatching(/^sw-/),
        request: expect.objectContaining({ requestId: 'prepare-2' }),
      }),
    ])
    expect(sentRequests[0]!.requestId).not.toBe(sentRequests[1]!.requestId)
    expect(mocks.offscreenReleases.every((release) => release.mock.calls.length === 1)).toBe(true)
  })

  it('propagates caller cancellation to the same offscreen request and ignores its late response', async () => {
    registerChromiumBackground()
    const invokeHost = mocks.registerBroker.mock.calls[0]![0] as HostInvoker
    let resolveResponse: ((response: HostResponse) => void) | undefined
    mocks.sendRuntimeMessage.mockImplementation((message: { operation: string }) => {
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
    await vi.waitFor(() => expect(mocks.sendRuntimeMessage).toHaveBeenCalledTimes(1))
    const requestMessage = mocks.sendRuntimeMessage.mock.calls[0]![0] as { requestId: string }

    controller.abort()

    await expect(invocation).rejects.toThrow('推理请求已取消')
    expect(mocks.sendRuntimeMessage).toHaveBeenCalledWith({
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'cancel',
      requestId: requestMessage.requestId,
    })
    expect(mocks.offscreenReleases[0]).not.toHaveBeenCalled()

    resolveResponse?.({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'prepare-cancel',
      ok: true,
    })
    await vi.waitFor(() => expect(mocks.offscreenReleases[0]).toHaveBeenCalledTimes(1))
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

  it('tracks offscreen work by request ID and safely handles duplicate, early, and late cancellation', async () => {
    let receivedSignal: AbortSignal | undefined
    let resolveHost: ((response: HostResponse) => void) | undefined
    const host = {
      handle: vi.fn(
        (_request: unknown, signal: AbortSignal) =>
          new Promise<HostResponse>((resolve) => {
            receivedSignal = signal
            resolveHost = resolve
          }),
      ),
      destroy: vi.fn(),
    }
    registerOffscreenHost(() => host as never)
    const listener = mocks.addRuntimeMessageListener.mock.calls[0]![0] as RuntimeMessageListener
    const sendResponse = vi.fn()
    const requestMessage = {
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'request',
      requestId: 'offscreen-active',
      request: { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-offscreen' },
    } as const

    expect(listener(requestMessage, { id: 'extension-id' }, sendResponse)).toBe(true)
    await vi.waitFor(() => expect(receivedSignal).toBeInstanceOf(AbortSignal))
    const duplicateResponse = vi.fn()
    expect(listener(requestMessage, { id: 'extension-id' }, duplicateResponse)).toBe(false)
    expect(duplicateResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))

    const cancelMessage = {
      type: OFFSCREEN_MESSAGE_TYPE,
      operation: 'cancel',
      requestId: requestMessage.requestId,
    } as const
    expect(listener(cancelMessage, { id: 'extension-id' }, vi.fn())).toBe(false)
    expect(listener(cancelMessage, { id: 'extension-id' }, vi.fn())).toBe(false)
    expect(receivedSignal?.aborted).toBe(true)

    resolveHost?.({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'prepare-offscreen',
      ok: true,
    })
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false })))
    expect(listener(cancelMessage, { id: 'extension-id' }, vi.fn())).toBe(false)

    const earlyCancel = { ...cancelMessage, requestId: 'offscreen-early' }
    listener(earlyCancel, { id: 'extension-id' }, vi.fn())
    const earlyResponse = vi.fn()
    expect(listener({ ...requestMessage, requestId: 'offscreen-early' }, { id: 'extension-id' }, earlyResponse)).toBe(
      false,
    )
    expect(earlyResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
    expect(host.handle).toHaveBeenCalledTimes(1)
  })
})
