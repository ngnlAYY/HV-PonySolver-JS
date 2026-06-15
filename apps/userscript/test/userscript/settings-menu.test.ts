import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('settings menu', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('registers one top-level userscript settings menu', async () => {
    const registerMenuCommand = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    const { registerSettingsMenu } = await import('../../src/userscript/settings-menu')

    registerSettingsMenu()

    expect(registerMenuCommand).toHaveBeenCalledTimes(1)
    expect(registerMenuCommand).toHaveBeenCalledWith('HV-PonySolver 设置', expect.any(Function))
  })

  it('rejects non-decimal top-level menu choices', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn(() => '0x3')
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { registerSettingsMenu } = await import('../../src/userscript/settings-menu')

    registerSettingsMenu()
    await registerMenuCommand.mock.calls[0][1]()

    expect(alert).toHaveBeenCalledWith('设置失败: Error: 设置选项无效')
    expect(localStorage.getItem('hvPonySolverHistoryLimit')).toBeNull()
  })

  it('sets the answer record display limit through the top-level settings menu', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn()
      .mockReturnValueOnce('3')
      .mockReturnValueOnce('4')
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { registerSettingsMenu } = await import('../../src/userscript/settings-menu')

    registerSettingsMenu()
    await registerMenuCommand.mock.calls[0][1]()

    expect(prompt).toHaveBeenNthCalledWith(1, expect.stringContaining('3. 设置答题记录显示条数'), '1')
    expect(prompt).toHaveBeenNthCalledWith(2, '请输入答题记录显示条数，1 到 50', '5')
    expect(localStorage.getItem('hvPonySolverHistoryLimit')).toBe('4')
    expect(alert).toHaveBeenCalledWith('答题记录显示条数已保存，刷新页面后生效')
  })
})
