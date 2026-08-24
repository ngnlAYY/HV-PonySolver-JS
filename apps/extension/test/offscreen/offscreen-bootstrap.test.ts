import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeMessageListener } from '../../src/platform/webextension'
import {
  MAX_OFFSCREEN_IDLE_NOTIFICATIONS,
  OFFSCREEN_IDLE_NOTIFICATION_MAX_RETRY_MS,
  OFFSCREEN_IDLE_NOTIFICATION_RETRY_BASE_MS,
  OFFSCREEN_IDLE_TIMEOUT_MS,
  registerOffscreenHost,
} from '../../src/offscreen/offscreen-bootstrap'
import { OFFSCREEN_MESSAGE_TYPE } from '../../src/protocol/messages'

const mocks = vi.hoisted(() => ({
  addRuntimeMessageListener: vi.fn(),
  runtimeGetUrl: vi.fn((path: string) => `chrome-extension://extension-id/${path}`),
  runtimeId: vi.fn(() => 'extension-id'),
  sendRuntimeMessage: vi.fn(async (..._message: unknown[]) => undefined),
}))

vi.mock('../../src/platform/webextension', () => ({
  addRuntimeMessageListener: mocks.addRuntimeMessageListener,
  runtimeGetUrl: mocks.runtimeGetUrl,
  runtimeId: mocks.runtimeId,
  sendRuntimeMessage: mocks.sendRuntimeMessage,
}))

const serviceWorkerSender = {
  id: 'extension-id',
  url: 'chrome-extension://extension-id/background.js',
} as const

function idleNotifications(): Array<Record<string, unknown>> {
  return mocks.sendRuntimeMessage.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter((message) => message.operation === 'idle')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.sendRuntimeMessage.mockImplementation(async () => undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('offscreen idle-notification backoff', () => {
  it('escalates 5s -> 10s -> 20s -> 40s -> capped 60s and gives up after the attempt limit', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn')
    registerOffscreenHost(() => ({ handle: vi.fn(), destroy: vi.fn() }) as never)
    const listener = mocks.addRuntimeMessageListener.mock.calls[0]![0] as RuntimeMessageListener
    const sendResponse = vi.fn()
    listener(
      { type: OFFSCREEN_MESSAGE_TYPE, operation: 'claim', epoch: 'epoch-giveup' },
      serviceWorkerSender,
      sendResponse,
    )

    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_TIMEOUT_MS)
    expect(idleNotifications()).toHaveLength(1)

    const escalationSteps = [1, 2, 3, 4].map((step) => OFFSCREEN_IDLE_NOTIFICATION_RETRY_BASE_MS * 2 ** (step - 1))
    for (const step of escalationSteps) {
      await vi.advanceTimersByTimeAsync(step)
      expect(idleNotifications()).toHaveLength(idleNotifications().length)
    }
    const escalatedCount = idleNotifications().length
    expect(escalatedCount).toBe(5)

    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_NOTIFICATION_MAX_RETRY_MS)
    expect(idleNotifications()).toHaveLength(6)

    // Drain the remaining attempts up to the cap.
    while (idleNotifications().length < MAX_OFFSCREEN_IDLE_NOTIFICATIONS) {
      await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_NOTIFICATION_MAX_RETRY_MS)
    }
    expect(warnSpy).not.toHaveBeenCalled()

    // One more due retry trips the give-up: warn once, never notify again.
    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_NOTIFICATION_MAX_RETRY_MS)
    expect(idleNotifications()).toHaveLength(MAX_OFFSCREEN_IDLE_NOTIFICATIONS)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PonySolverLocal]'),
      expect.stringContaining('暂停心跳'),
    )

    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_NOTIFICATION_MAX_RETRY_MS * 10)
    expect(idleNotifications()).toHaveLength(MAX_OFFSCREEN_IDLE_NOTIFICATIONS)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('restarts the backoff budget when the service worker confirms the generation', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn')
    registerOffscreenHost(() => ({ handle: vi.fn(), destroy: vi.fn() }) as never)
    const listener = mocks.addRuntimeMessageListener.mock.calls[0]![0] as RuntimeMessageListener
    listener({ type: OFFSCREEN_MESSAGE_TYPE, operation: 'claim', epoch: 'epoch-confirm' }, serviceWorkerSender, vi.fn())

    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_TIMEOUT_MS + OFFSCREEN_IDLE_NOTIFICATION_RETRY_BASE_MS)
    expect(idleNotifications()).toHaveLength(2)
    const generation = idleNotifications()[0]!.generation

    // Repeated confirmations keep the heartbeat alive well past the give-up cap.
    for (let cycle = 0; cycle < 8; cycle += 1) {
      listener(
        {
          type: OFFSCREEN_MESSAGE_TYPE,
          operation: 'confirm-idle',
          epoch: 'epoch-confirm',
          generation,
        },
        serviceWorkerSender,
        vi.fn(),
      )
      await vi.advanceTimersByTimeAsync(
        OFFSCREEN_IDLE_NOTIFICATION_RETRY_BASE_MS * 2 ** 1 + OFFSCREEN_IDLE_NOTIFICATION_RETRY_BASE_MS,
      )
      expect(idleNotifications().length).toBeGreaterThanOrEqual(2 + cycle * 2)
    }

    expect(idleNotifications().length).toBeGreaterThan(MAX_OFFSCREEN_IDLE_NOTIFICATIONS)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('re-arms a fresh heartbeat for a later generation after giving up', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn')
    const handle = vi.fn(async (): Promise<unknown> => ({}))
    registerOffscreenHost(() => ({ handle, destroy: vi.fn() }) as never)
    const listener = mocks.addRuntimeMessageListener.mock.calls[0]![0] as RuntimeMessageListener
    listener({ type: OFFSCREEN_MESSAGE_TYPE, operation: 'claim', epoch: 'epoch-rearm' }, serviceWorkerSender, vi.fn())

    // Burn through every attempt so the heartbeat is parked.
    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_TIMEOUT_MS)
    while (idleNotifications().length < MAX_OFFSCREEN_IDLE_NOTIFICATIONS) {
      await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_NOTIFICATION_MAX_RETRY_MS)
    }
    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_NOTIFICATION_MAX_RETRY_MS)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // New Host activity starts a new generation with a fresh budget.
    mocks.sendRuntimeMessage.mockClear()
    listener(
      {
        type: OFFSCREEN_MESSAGE_TYPE,
        operation: 'request',
        epoch: 'epoch-rearm',
        requestId: 'offscreen-rearm',
        request: { protocol: 'hv-pony-solver/2', type: 'prepare', requestId: 'prepare-rearm' },
      },
      serviceWorkerSender,
      vi.fn(),
    )
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_TIMEOUT_MS)
    expect(idleNotifications()).toHaveLength(1)
    expect(idleNotifications()[0]!.epoch).toBe('epoch-rearm')
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
