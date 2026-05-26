import { beforeEach, describe, expect, it, vi } from 'vitest'

const gmGetValue = vi.fn()
const gmSetValue = vi.fn(async () => undefined)
const gmDeleteValue = vi.fn(async () => undefined)
const gmRegisterMenuCommand = vi.fn()

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  gmGetValue.mockReset()
  gmSetValue.mockReset()
  gmDeleteValue.mockReset()
  gmRegisterMenuCommand.mockReset()
  gmSetValue.mockResolvedValue(undefined)
  gmDeleteValue.mockResolvedValue(undefined)
  ;(globalThis as typeof globalThis & {
    GM_getValue?: typeof gmGetValue
    GM_setValue?: typeof gmSetValue
    GM_deleteValue?: typeof gmDeleteValue
    GM_registerMenuCommand?: typeof gmRegisterMenuCommand
  }).GM_getValue = gmGetValue
  ;(globalThis as typeof globalThis & {
    GM_getValue?: typeof gmGetValue
    GM_setValue?: typeof gmSetValue
    GM_deleteValue?: typeof gmDeleteValue
    GM_registerMenuCommand?: typeof gmRegisterMenuCommand
  }).GM_setValue = gmSetValue
  ;(globalThis as typeof globalThis & {
    GM_getValue?: typeof gmGetValue
    GM_setValue?: typeof gmSetValue
    GM_deleteValue?: typeof gmDeleteValue
    GM_registerMenuCommand?: typeof gmRegisterMenuCommand
  }).GM_deleteValue = gmDeleteValue
  ;(globalThis as typeof globalThis & {
    GM_getValue?: typeof gmGetValue
    GM_setValue?: typeof gmSetValue
    GM_deleteValue?: typeof gmDeleteValue
    GM_registerMenuCommand?: typeof gmRegisterMenuCommand
  }).GM_registerMenuCommand = gmRegisterMenuCommand
})

describe('debug-settings', () => {
  it('reads debug flag from synchronous userscript storage', async () => {
    gmGetValue.mockReturnValueOnce('1')
    const { DEBUG_STORAGE_KEY, isDebugEnabled } = await import('../../src/userscript/debug-settings')

    expect(isDebugEnabled()).toBe(true)
    expect(gmGetValue).toHaveBeenCalledWith(DEBUG_STORAGE_KEY, '')
  })

  it('registers enable and disable debug menu actions', async () => {
    const { registerDebugSettingsMenu } = await import('../../src/userscript/debug-settings')

    registerDebugSettingsMenu()

    expect(gmRegisterMenuCommand).toHaveBeenCalledTimes(2)
    expect(gmRegisterMenuCommand).toHaveBeenNthCalledWith(1, '开启调试日志', expect.any(Function))
    expect(gmRegisterMenuCommand).toHaveBeenNthCalledWith(2, '关闭调试日志', expect.any(Function))
  })

  it('enables and disables debug logs through menu actions and alerts user', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined)
    const { DEBUG_STORAGE_KEY, registerDebugSettingsMenu } = await import('../../src/userscript/debug-settings')

    registerDebugSettingsMenu()
    const enableAction = gmRegisterMenuCommand.mock.calls[0][1]
    const disableAction = gmRegisterMenuCommand.mock.calls[1][1]

    await enableAction()
    await disableAction()

    expect(gmSetValue).toHaveBeenCalledWith(DEBUG_STORAGE_KEY, '1')
    expect(gmDeleteValue).toHaveBeenCalledWith(DEBUG_STORAGE_KEY)
    expect(alertSpy).toHaveBeenCalledWith('调试日志已开启')
    expect(alertSpy).toHaveBeenCalledWith('调试日志已关闭')
  })
})
