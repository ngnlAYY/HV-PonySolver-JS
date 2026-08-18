import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  closeDocument: vi.fn<() => Promise<void>>(),
  createDocument: vi.fn<() => Promise<void>>(),
  getContexts: vi.fn<() => Promise<unknown[]>>(),
  runtimeGetUrl: vi.fn(() => 'chrome-extension://extension-id/offscreen.html'),
}))

vi.mock('../../src/platform/webextension', () => ({
  getChromiumOffscreenApi: () => ({
    closeDocument: mocks.closeDocument,
    createDocument: mocks.createDocument,
    getContexts: mocks.getContexts,
  }),
  runtimeGetUrl: mocks.runtimeGetUrl,
}))

async function lifecycle() {
  return import('../../src/background/chromium-offscreen')
}

describe('Chromium offscreen lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.clearAllMocks()
    mocks.closeDocument.mockResolvedValue(undefined)
    mocks.createDocument.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces concurrent creation attempts', async () => {
    let resolveContexts: ((contexts: unknown[]) => void) | undefined
    mocks.getContexts.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveContexts = resolve
        }),
    )
    const { ensureOffscreenDocument } = await lifecycle()

    const first = ensureOffscreenDocument()
    const second = ensureOffscreenDocument()
    resolveContexts?.([])
    await Promise.all([first, second])

    expect(mocks.getContexts).toHaveBeenCalledTimes(1)
    expect(mocks.createDocument).toHaveBeenCalledTimes(1)
  })

  it('does not create another document when a matching context exists', async () => {
    mocks.getContexts.mockResolvedValue([{}])
    const { ensureOffscreenDocument } = await lifecycle()

    await ensureOffscreenDocument()

    expect(mocks.createDocument).not.toHaveBeenCalled()
  })

  it('closes only after the final active or queued lease becomes idle', async () => {
    mocks.getContexts.mockResolvedValueOnce([]).mockResolvedValue([{}])
    const { OFFSCREEN_IDLE_TIMEOUT_MS, acquireOffscreenDocument } = await lifecycle()
    const releaseFirst = await acquireOffscreenDocument()
    const releaseSecond = await acquireOffscreenDocument()

    releaseFirst()
    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_TIMEOUT_MS)
    expect(mocks.closeDocument).not.toHaveBeenCalled()

    releaseSecond()
    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_TIMEOUT_MS)
    await vi.waitFor(() => expect(mocks.closeDocument).toHaveBeenCalledTimes(1))
  })

  it('waits for an in-progress idle close and recreates before admitting a racing request', async () => {
    let resolveClose: (() => void) | undefined
    mocks.getContexts.mockResolvedValueOnce([]).mockResolvedValueOnce([{}]).mockResolvedValueOnce([])
    mocks.closeDocument.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveClose = resolve
      }),
    )
    const { OFFSCREEN_IDLE_TIMEOUT_MS, acquireOffscreenDocument } = await lifecycle()
    const releaseFirst = await acquireOffscreenDocument()
    releaseFirst()
    await vi.advanceTimersByTimeAsync(OFFSCREEN_IDLE_TIMEOUT_MS)
    await vi.waitFor(() => expect(mocks.closeDocument).toHaveBeenCalledTimes(1))

    const racingLease = acquireOffscreenDocument()
    await Promise.resolve()
    expect(mocks.createDocument).toHaveBeenCalledTimes(1)

    resolveClose?.()
    const releaseRacing = await racingLease

    expect(mocks.createDocument).toHaveBeenCalledTimes(2)
    releaseRacing()
  })
})
