import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type TestGlobal = typeof globalThis & {
  GM_getValue?: (key: string, defaultValue: string) => string | Promise<string>
  GM_setValue?: (key: string, value: string) => void | Promise<void>
  GM_deleteValue?: (key: string) => void | Promise<void>
  GM_registerMenuCommand?: (caption: string, command: () => void | Promise<void>) => void
}

const testGlobal = globalThis as TestGlobal

describe('gm-bridge', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    delete testGlobal.GM_getValue
    delete testGlobal.GM_setValue
    delete testGlobal.GM_deleteValue
    delete testGlobal.GM_registerMenuCommand
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads from GM_getValue when it is available', async () => {
    const gmGetValue = vi.fn(() => '  token  ')
    testGlobal.GM_getValue = gmGetValue
    const { getGmValue } = await import('../../src/userscript/gm-bridge')

    await expect(getGmValue('key', 'fallback')).resolves.toBe('token')
    expect(gmGetValue).toHaveBeenCalledWith('key', 'fallback')
  })

  it('reads matching values through async and sync localStorage paths', async () => {
    localStorage.setItem('key', '  value  ')
    const { getGmValue, getGmValueSync } = await import('../../src/userscript/gm-bridge')

    await expect(getGmValue('key')).resolves.toBe('value')
    expect(getGmValueSync('key')).toBe('value')
  })

  it('reads from synchronous GM_getValue in the sync path when it is available', async () => {
    const gmGetValue = vi.fn(() => '  enabled  ')
    testGlobal.GM_getValue = gmGetValue
    const { getGmValueSync } = await import('../../src/userscript/gm-bridge')

    expect(getGmValueSync('key', 'fallback')).toBe('enabled')
    expect(gmGetValue).toHaveBeenCalledWith('key', 'fallback')
  })

  it('returns null when safeStorage.getItem catches localStorage errors', async () => {
    const { safeStorage } = await import('../../src/userscript/gm-bridge')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(safeStorage.getItem('key')).toBeNull()
  })

  it('returns false when GM_registerMenuCommand is unavailable', async () => {
    const { registerGmMenu } = await import('../../src/userscript/gm-bridge')

    expect(registerGmMenu('caption', vi.fn())).toBe(false)
  })
})
