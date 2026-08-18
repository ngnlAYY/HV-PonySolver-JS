import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerOpenOptionsAction } from '../../src/platform/webextension-action'
import { getChromiumOffscreenApi } from '../../src/platform/webextension-offscreen'
import { rawExtensionApi } from './webextension-api-fixture'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('webextension offscreen and action adapters', () => {
  it('exposes Chromium-only offscreen capabilities', async () => {
    const api = rawExtensionApi()
    vi.stubGlobal('chrome', api)
    const offscreen = getChromiumOffscreenApi()

    await expect(
      offscreen.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: ['offscreen.html'] }),
    ).resolves.toEqual([])
    await offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'test',
    })

    await offscreen.closeDocument()

    expect(api.offscreen?.createDocument).toHaveBeenCalledTimes(1)
    expect(api.offscreen?.closeDocument).toHaveBeenCalledTimes(1)
  })

  it('registers and removes the Chromium options action callback', () => {
    const api = rawExtensionApi()
    vi.stubGlobal('chrome', api)

    const unregister = registerOpenOptionsAction()
    ;(api.action.onClicked as unknown as { emit(): void }).emit()

    expect(api.runtime.openOptionsPage).toHaveBeenCalledWith(expect.any(Function))
    unregister()
    expect(api.action.onClicked.removeListener).toHaveBeenCalledTimes(1)
  })

  it('fails closed when Chromium offscreen capabilities are absent', () => {
    const api = rawExtensionApi()
    const withoutOffscreen = { ...api, offscreen: undefined, runtime: { ...api.runtime, getContexts: undefined } }
    vi.stubGlobal('chrome', withoutOffscreen)

    expect(() => getChromiumOffscreenApi()).toThrow('当前 Chromium 不支持 Offscreen Document')
  })
})
