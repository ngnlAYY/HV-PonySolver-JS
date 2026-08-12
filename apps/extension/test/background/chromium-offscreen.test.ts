import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createDocument: vi.fn<() => Promise<void>>(),
  getContexts: vi.fn<() => Promise<unknown[]>>(),
  runtimeGetUrl: vi.fn(() => 'chrome-extension://extension-id/offscreen.html'),
}))

vi.mock('../../src/platform/webextension', () => ({
  getChromiumOffscreenApi: () => ({
    createDocument: mocks.createDocument,
    getContexts: mocks.getContexts,
  }),
  runtimeGetUrl: mocks.runtimeGetUrl,
}))

import { ensureOffscreenDocument } from '../../src/background/chromium-offscreen'

describe('Chromium offscreen lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    const first = ensureOffscreenDocument()
    const second = ensureOffscreenDocument()
    resolveContexts?.([])
    await Promise.all([first, second])

    expect(mocks.getContexts).toHaveBeenCalledTimes(1)
    expect(mocks.createDocument).toHaveBeenCalledTimes(1)
  })

  it('does not create another document when a matching context exists', async () => {
    mocks.getContexts.mockResolvedValue([{}])

    await ensureOffscreenDocument()

    expect(mocks.createDocument).not.toHaveBeenCalled()
  })
})
