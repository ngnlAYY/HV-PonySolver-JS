import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    vi.resetModules()
    vi.clearAllMocks()
    mocks.closeDocument.mockResolvedValue(undefined)
    mocks.createDocument.mockResolvedValue(undefined)
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
    const { ensureOffscreenDocument, hasOffscreenDocument } = await lifecycle()

    await expect(hasOffscreenDocument()).resolves.toBe(true)
    await ensureOffscreenDocument()

    expect(mocks.createDocument).not.toHaveBeenCalled()
  })

  it('does not close while a request is being admitted', async () => {
    mocks.getContexts.mockResolvedValueOnce([])
    const { acquireOffscreenAdmission, closeOffscreenDocumentIfIdle } = await lifecycle()
    const release = await acquireOffscreenAdmission()
    const confirmIdle = vi.fn(async () => true)

    await closeOffscreenDocumentIfIdle(confirmIdle)

    expect(confirmIdle).not.toHaveBeenCalled()
    expect(mocks.closeDocument).not.toHaveBeenCalled()
    release()
  })

  it('requires an authoritative idle confirmation before closing', async () => {
    mocks.getContexts.mockResolvedValue([{}])
    const { closeOffscreenDocumentIfIdle } = await lifecycle()

    await closeOffscreenDocumentIfIdle(async () => false)
    expect(mocks.closeDocument).not.toHaveBeenCalled()

    await closeOffscreenDocumentIfIdle(async () => true)
    expect(mocks.closeDocument).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent close attempts', async () => {
    let resolveConfirmation: ((idle: boolean) => void) | undefined
    const confirmation = new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve
    })
    mocks.getContexts.mockResolvedValue([{}])
    const { closeOffscreenDocumentIfIdle } = await lifecycle()

    const first = closeOffscreenDocumentIfIdle(() => confirmation)
    const second = closeOffscreenDocumentIfIdle(async () => true)
    resolveConfirmation?.(true)
    await Promise.all([first, second])

    expect(mocks.closeDocument).toHaveBeenCalledTimes(1)
  })

  it('waits for an in-progress close and recreates before admitting a racing request', async () => {
    let resolveClose: (() => void) | undefined
    mocks.getContexts.mockResolvedValueOnce([{}]).mockResolvedValueOnce([])
    mocks.closeDocument.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveClose = resolve
      }),
    )
    const { acquireOffscreenAdmission, closeOffscreenDocumentIfIdle } = await lifecycle()

    const close = closeOffscreenDocumentIfIdle(async () => true)
    await vi.waitFor(() => expect(mocks.closeDocument).toHaveBeenCalledTimes(1))
    const racingAdmission = acquireOffscreenAdmission()
    await Promise.resolve()
    expect(mocks.createDocument).not.toHaveBeenCalled()

    resolveClose?.()
    await close
    const release = await racingAdmission

    expect(mocks.createDocument).toHaveBeenCalledTimes(1)
    release()
  })

  it('keeps admission release idempotent', async () => {
    mocks.getContexts.mockResolvedValueOnce([]).mockResolvedValue([{}])
    const { acquireOffscreenAdmission, closeOffscreenDocumentIfIdle } = await lifecycle()
    const release = await acquireOffscreenAdmission()

    release()
    release()
    await closeOffscreenDocumentIfIdle(async () => true)

    expect(mocks.closeDocument).toHaveBeenCalledTimes(1)
  })

  it('leaves cleanup retryable when close fails', async () => {
    mocks.getContexts.mockResolvedValue([{}])
    mocks.closeDocument.mockRejectedValueOnce(new Error('close failed')).mockResolvedValueOnce(undefined)
    const { closeOffscreenDocumentIfIdle } = await lifecycle()

    await expect(closeOffscreenDocumentIfIdle(async () => true)).resolves.toBeUndefined()
    await expect(closeOffscreenDocumentIfIdle(async () => true)).resolves.toBeUndefined()

    expect(mocks.closeDocument).toHaveBeenCalledTimes(2)
  })
})
