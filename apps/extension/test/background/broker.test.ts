import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as WebExtensionModule from '../../src/platform/webextension'

const platformMocks = vi.hoisted(() => ({
  connectListener: undefined as ((port: ExtensionPort) => void) | undefined,
}))

vi.mock('../../src/platform/webextension', async (importOriginal) => {
  const actual = await importOriginal<typeof WebExtensionModule>()
  return {
    ...actual,
    addRuntimeConnectListener: vi.fn((listener: (port: ExtensionPort) => void) => {
      platformMocks.connectListener = listener
      return vi.fn()
    }),
    runtimeId: () => 'extension-id',
    runtimeGetUrl: () => 'moz-extension://extension-id/options.html',
  }
})

import {
  BROKER_DEFAULT_TIMEOUT_MS,
  MAX_GLOBAL_DETECT_REQUESTS,
  MAX_GLOBAL_VERIFY_KEY_REQUESTS,
  MAX_PORT_DETECT_REQUESTS,
  MAX_PORT_VERIFY_KEY_REQUESTS,
  isTrustedPort,
  registerBroker,
} from '../../src/background/broker'
import {
  CONTENT_PORT_NAME,
  OPTIONS_PORT_NAME,
  PROTOCOL_VERSION,
  type HostRequest,
  type HostResponse,
} from '../../src/protocol/messages'
import type { ExtensionPort, ExtensionSender } from '../../src/platform/webextension'

type TestPort = ExtensionPort &
  Readonly<{
    emitMessage(message: unknown): void
    emitDisconnect(): void
  }>

function port(name: string, sender: ExtensionSender): TestPort {
  let messageListener: ((message: unknown) => void) | undefined
  let disconnectListener: (() => void) | undefined
  return {
    name,
    sender,
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

function detectRequest(index: number): Record<string, unknown> {
  return {
    protocol: PROTOCOL_VERSION,
    type: 'detect',
    requestId: `detect-${index}`,
    imageBase64: 'AQID',
    mimeType: 'image/png',
  }
}

function verifyKeyRequest(index: number): Record<string, unknown> {
  return {
    protocol: PROTOCOL_VERSION,
    type: 'verify-key',
    requestId: `verify-${index}`,
    candidateKey: index.toString(16).padStart(64, '0'),
  }
}

beforeEach(() => {
  vi.useRealTimers()
  platformMocks.connectListener = undefined
})

afterEach(() => {
  vi.useRealTimers()
})

describe('broker sender validation', () => {
  const extensionId = 'extension-id'
  const optionsUrl = 'moz-extension://extension-id/options.html'

  it('accepts only the declared HentaiVerse content origins', () => {
    expect(
      isTrustedPort(
        port(CONTENT_PORT_NAME, { id: extensionId, url: 'https://hentaiverse.org/?s=Battle' }),
        extensionId,
        optionsUrl,
      ),
    ).toBe(true)
    expect(
      isTrustedPort(
        port(CONTENT_PORT_NAME, { id: extensionId, url: 'https://alt.hentaiverse.org/isekai/' }),
        extensionId,
        optionsUrl,
      ),
    ).toBe(true)
    expect(
      isTrustedPort(
        port(CONTENT_PORT_NAME, { id: extensionId, url: 'https://hentaiverse.org.evil.invalid/' }),
        extensionId,
        optionsUrl,
      ),
    ).toBe(false)
    expect(
      isTrustedPort(
        port(CONTENT_PORT_NAME, { id: 'other-id', url: 'https://hentaiverse.org/' }),
        extensionId,
        optionsUrl,
      ),
    ).toBe(false)
  })

  it('accepts the extension options page but rejects unrelated extension pages', () => {
    expect(
      isTrustedPort(port(OPTIONS_PORT_NAME, { id: extensionId, url: `${optionsUrl}#key` }), extensionId, optionsUrl),
    ).toBe(true)
    expect(
      isTrustedPort(
        port(OPTIONS_PORT_NAME, { id: extensionId, url: 'moz-extension://extension-id/untrusted.html' }),
        extensionId,
        optionsUrl,
      ),
    ).toBe(false)
    expect(isTrustedPort(port('unknown', { id: extensionId, url: optionsUrl }), extensionId, optionsUrl)).toBe(false)
  })
})

describe('broker queue and privilege boundaries', () => {
  it('limits pending detects per content Port and releases capacity after completion', async () => {
    const resolvers: Array<(response: HostResponse) => void> = []
    const invokeHost = vi.fn(
      () =>
        new Promise<HostResponse>((resolve) => {
          resolvers.push(resolve)
        }),
    )
    registerBroker(invokeHost)
    const client = port(CONTENT_PORT_NAME, { id: 'extension-id', url: 'https://hentaiverse.org/' })
    platformMocks.connectListener?.(client)

    for (let index = 0; index < MAX_PORT_DETECT_REQUESTS + 1; index += 1) {
      client.emitMessage(detectRequest(index))
    }

    expect(invokeHost).toHaveBeenCalledTimes(MAX_PORT_DETECT_REQUESTS)
    expect(client.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: `detect-${MAX_PORT_DETECT_REQUESTS}`,
        ok: false,
        error: expect.stringContaining('繁忙'),
      }),
    )

    resolvers.shift()?.({ protocol: PROTOCOL_VERSION, type: 'result', requestId: 'detect-0', ok: true })
    await vi.waitFor(() =>
      expect(client.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'detect-0', ok: true })),
    )
    await Promise.resolve()
    client.emitMessage(detectRequest(10))
    expect(invokeHost).toHaveBeenCalledTimes(MAX_PORT_DETECT_REQUESTS + 1)

    for (const [index, resolve] of resolvers.entries()) {
      resolve({ protocol: PROTOCOL_VERSION, type: 'result', requestId: `remaining-${index}`, ok: true })
    }
  })

  it('keeps disconnected running work admitted until Host settlement and releases exactly once', async () => {
    const pending = new Map<string, Readonly<{ resolve: (response: HostResponse) => void; signal: AbortSignal }>>()
    const invokeHost = vi.fn(
      (request: { requestId: string }, signal: AbortSignal) =>
        new Promise<HostResponse>((resolve) => {
          pending.set(request.requestId, { resolve, signal })
        }),
    )
    registerBroker(invokeHost)
    const clients = Array.from({ length: 4 }, () =>
      port(CONTENT_PORT_NAME, { id: 'extension-id', url: 'https://hentaiverse.org/' }),
    )
    for (const client of clients) {
      platformMocks.connectListener?.(client)
    }
    for (let index = 0; index < MAX_GLOBAL_DETECT_REQUESTS; index += 1) {
      clients[Math.floor(index / MAX_PORT_DETECT_REQUESTS)]!.emitMessage(detectRequest(index))
    }
    expect(invokeHost).toHaveBeenCalledTimes(MAX_GLOBAL_DETECT_REQUESTS)

    clients[0]!.emitDisconnect()
    expect(pending.get('detect-0')?.signal.aborted).toBe(true)
    expect(pending.get('detect-1')?.signal.aborted).toBe(true)

    clients[3]!.emitMessage(detectRequest(99))
    expect(invokeHost).toHaveBeenCalledTimes(MAX_GLOBAL_DETECT_REQUESTS)
    expect(clients[3]!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'detect-99', ok: false, error: expect.stringContaining('繁忙') }),
    )

    pending.get('detect-0')?.resolve({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'detect-0',
      ok: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    clients[3]!.emitMessage(detectRequest(100))
    expect(invokeHost).toHaveBeenCalledTimes(MAX_GLOBAL_DETECT_REQUESTS + 1)
    expect(clients[0]!.postMessage).not.toHaveBeenCalled()

    for (const [requestId, entry] of pending) {
      entry.resolve({ protocol: PROTOCOL_VERSION, type: 'result', requestId, ok: true })
    }
  })

  it('applies independent per-Port and global verify-key limits and releases capacity', async () => {
    const pending = new Map<string, (response: HostResponse) => void>()
    const invokeHost = vi.fn(
      (request: { requestId: string }) =>
        new Promise<HostResponse>((resolve) => {
          pending.set(request.requestId, resolve)
        }),
    )
    registerBroker(invokeHost)
    const clients = Array.from({ length: MAX_GLOBAL_VERIFY_KEY_REQUESTS + 1 }, () =>
      port(OPTIONS_PORT_NAME, {
        id: 'extension-id',
        url: 'moz-extension://extension-id/options.html',
      }),
    )
    for (const client of clients) {
      platformMocks.connectListener?.(client)
    }

    clients[0]!.emitMessage(verifyKeyRequest(0))
    clients[0]!.emitMessage(verifyKeyRequest(100))
    expect(MAX_PORT_VERIFY_KEY_REQUESTS).toBe(1)
    expect(clients[0]!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'verify-100', ok: false, error: expect.stringContaining('繁忙') }),
    )

    for (let index = 1; index < MAX_GLOBAL_VERIFY_KEY_REQUESTS; index += 1) {
      clients[index]!.emitMessage(verifyKeyRequest(index))
    }
    clients[MAX_GLOBAL_VERIFY_KEY_REQUESTS]!.emitMessage(verifyKeyRequest(200))
    expect(invokeHost).toHaveBeenCalledTimes(MAX_GLOBAL_VERIFY_KEY_REQUESTS)
    expect(clients[MAX_GLOBAL_VERIFY_KEY_REQUESTS]!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'verify-200', ok: false, error: expect.stringContaining('繁忙') }),
    )

    pending.get('verify-0')?.({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'verify-0',
      ok: true,
    })
    await vi.waitFor(() =>
      expect(clients[0]!.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'verify-0', ok: true }),
      ),
    )
    clients[MAX_GLOBAL_VERIFY_KEY_REQUESTS]!.emitMessage(verifyKeyRequest(201))
    expect(invokeHost).toHaveBeenCalledTimes(MAX_GLOBAL_VERIFY_KEY_REQUESTS + 1)

    for (const [requestId, resolve] of pending) {
      resolve({ protocol: PROTOCOL_VERSION, type: 'result', requestId, ok: true })
    }
  })

  it('aborts and releases a timed-out verify entry even when the Host never settles', async () => {
    vi.useFakeTimers()
    let receivedSignal: AbortSignal | undefined
    const invokeHost = vi.fn(
      (_request: HostRequest, signal: AbortSignal) =>
        new Promise<HostResponse>(() => {
          receivedSignal = signal
        }),
    )
    registerBroker(invokeHost)
    const client = port(OPTIONS_PORT_NAME, {
      id: 'extension-id',
      url: 'moz-extension://extension-id/options.html',
    })
    platformMocks.connectListener?.(client)
    client.emitMessage(verifyKeyRequest(300))

    await vi.advanceTimersByTimeAsync(BROKER_DEFAULT_TIMEOUT_MS)

    expect(receivedSignal?.aborted).toBe(true)
    expect(client.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'verify-300', ok: false, error: expect.stringContaining('超时') }),
    )
    client.emitMessage(verifyKeyRequest(301))
    expect(invokeHost).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed or mismatched Host responses using the original request ID', async () => {
    const invokeHost = vi.fn(async (): Promise<HostResponse> => ({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'foreign-request',
      ok: true,
    }))
    registerBroker(invokeHost)
    const client = port(CONTENT_PORT_NAME, { id: 'extension-id', url: 'https://hentaiverse.org/' })
    platformMocks.connectListener?.(client)

    client.emitMessage(detectRequest(7))

    await vi.waitFor(() =>
      expect(client.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'detect-7',
          ok: false,
          error: expect.stringContaining('无效或错配'),
        }),
      ),
    )
  })

  it('treats a delivery throw as disconnect without recursively posting another error', async () => {
    let signal: AbortSignal | undefined
    const invokeHost = vi.fn(
      async (request: { requestId: string }, requestSignal: AbortSignal): Promise<HostResponse> => {
        signal = requestSignal
        return {
          protocol: PROTOCOL_VERSION,
          type: 'result',
          requestId: request.requestId,
          ok: true,
        }
      },
    )
    registerBroker(invokeHost)
    const client = port(CONTENT_PORT_NAME, { id: 'extension-id', url: 'https://hentaiverse.org/' })
    vi.mocked(client.postMessage).mockImplementation(() => {
      throw new Error('Port closed')
    })
    platformMocks.connectListener?.(client)

    client.emitMessage(detectRequest(8))

    await vi.waitFor(() => expect(client.disconnect).toHaveBeenCalledTimes(1))
    expect(client.postMessage).toHaveBeenCalledTimes(1)
    expect(signal?.aborted).toBe(true)
  })

  it('does not allow content Ports to submit model keys', () => {
    const invokeHost = vi.fn(async (): Promise<HostResponse> => ({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'verify-1',
      ok: true,
    }))
    registerBroker(invokeHost)
    const client = port(CONTENT_PORT_NAME, { id: 'extension-id', url: 'https://hentaiverse.org/' })
    platformMocks.connectListener?.(client)

    client.emitMessage({
      protocol: PROTOCOL_VERSION,
      type: 'verify-key',
      requestId: 'verify-1',
      candidateKey: 'a'.repeat(64),
    })

    expect(client.disconnect).toHaveBeenCalledTimes(1)
    expect(invokeHost).not.toHaveBeenCalled()
  })

  it('retains a host resource for the lifetime of a content Port only', () => {
    const release = vi.fn()
    const onContentConnected = vi.fn(() => release)
    const invokeHost = vi.fn(async (): Promise<HostResponse> => ({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'retain',
      ok: true,
    }))
    registerBroker(invokeHost, { allowOptions: true, onContentConnected })

    const content = port(CONTENT_PORT_NAME, { id: 'extension-id', url: 'https://hentaiverse.org/' })
    platformMocks.connectListener?.(content)
    expect(onContentConnected).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()

    // The options page does no inference, so it must not pin the resource.
    const options = port(OPTIONS_PORT_NAME, {
      id: 'extension-id',
      url: 'moz-extension://extension-id/options.html',
    })
    platformMocks.connectListener?.(options)
    expect(onContentConnected).toHaveBeenCalledTimes(1)

    content.emitDisconnect()
    expect(release).toHaveBeenCalledTimes(1)

    // A repeated disconnect must not double-release the lease.
    content.emitDisconnect()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('admits a content Port even when retention setup throws', () => {
    const onContentConnected = vi.fn(() => {
      throw new Error('offscreen retention unavailable')
    })
    const invokeHost = vi.fn(async (request: { requestId: string }): Promise<HostResponse> => ({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: true,
    }))
    registerBroker(invokeHost, { allowOptions: true, onContentConnected })
    const client = port(CONTENT_PORT_NAME, { id: 'extension-id', url: 'https://hentaiverse.org/' })

    expect(() => platformMocks.connectListener?.(client)).not.toThrow()
    client.emitMessage(detectRequest(0))

    expect(client.disconnect).not.toHaveBeenCalled()
    expect(invokeHost).toHaveBeenCalledTimes(1)
  })

  it('disconnects the options Port when the selected product disallows Key operations', () => {
    const invokeHost = vi.fn(async (): Promise<HostResponse> => ({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'verify-packaged',
      ok: true,
    }))
    registerBroker(invokeHost, { allowOptions: false })
    const client = port(OPTIONS_PORT_NAME, {
      id: 'extension-id',
      url: 'moz-extension://extension-id/options.html',
    })
    platformMocks.connectListener?.(client)

    expect(client.disconnect).toHaveBeenCalledTimes(1)
    expect(invokeHost).not.toHaveBeenCalled()
  })
})
