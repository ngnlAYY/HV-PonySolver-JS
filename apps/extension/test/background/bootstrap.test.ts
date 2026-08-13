import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HostInvoker } from '../../src/background/broker'
import type * as BrokerModule from '../../src/background/broker'
import type { RuntimeMessageListener } from '../../src/platform/webextension'
import { PROTOCOL_VERSION } from '../../src/protocol/messages'

const mocks = vi.hoisted(() => ({
  addRuntimeMessageListener: vi.fn(),
  ensureOffscreenDocument: vi.fn(),
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
  ensureOffscreenDocument: mocks.ensureOffscreenDocument,
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
  mocks.ensureOffscreenDocument.mockResolvedValue(undefined)
})

describe('target-specific extension bootstraps', () => {
  it('registers Chromium with only the injected broker policy', async () => {
    registerChromiumBackground({ allowOptions: false })
    expect(mocks.registerBroker).toHaveBeenCalledWith(expect.any(Function), { allowOptions: false })
    expect(mocks.registerOpenOptionsAction).toHaveBeenCalledTimes(1)
    const invokeHost = mocks.registerBroker.mock.calls[0]![0] as HostInvoker
    const request = { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-1' } as const
    mocks.sendRuntimeMessage.mockResolvedValue({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: request.requestId,
      ok: true,
    })

    await expect(invokeHost(request, new AbortController().signal)).resolves.toMatchObject({ ok: true })
    expect(mocks.ensureOffscreenDocument).toHaveBeenCalledTimes(1)
  })

  it('registers Firefox with only the injected Host factory and policy', async () => {
    const host = {
      handle: vi.fn(async () => ({
        protocol: PROTOCOL_VERSION,
        type: 'result' as const,
        requestId: 'prepare-2',
        ok: true as const,
      })),
      destroy: vi.fn(),
    }
    registerFirefoxBackground(() => host as never, { allowOptions: false })
    const invokeHost = mocks.registerBroker.mock.calls[0]![0] as HostInvoker
    const signal = new AbortController().signal

    await invokeHost({ protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-2' }, signal)

    expect(host.handle).toHaveBeenCalledWith(
      { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-2' },
      signal,
    )
    expect(mocks.registerBroker).toHaveBeenCalledWith(expect.any(Function), { allowOptions: false })
  })

  it('registers an offscreen listener around only the injected Host', async () => {
    const host = {
      handle: vi.fn(async (request: { requestId: string }) => ({
        protocol: PROTOCOL_VERSION,
        type: 'result' as const,
        requestId: request.requestId,
        ok: true as const,
      })),
      destroy: vi.fn(),
    }
    registerOffscreenHost(() => host as never)
    const listener = mocks.addRuntimeMessageListener.mock.calls[0]![0] as RuntimeMessageListener
    const sendResponse = vi.fn()

    expect(
      listener(
        {
          type: 'hv-pony-solver:offscreen-request',
          request: { protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-3' },
        },
        { id: 'extension-id' },
        sendResponse,
      ),
    ).toBe(true)
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true })))
    expect(host.handle).toHaveBeenCalledTimes(1)
  })
})
