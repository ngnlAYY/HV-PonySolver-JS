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

  it('does not include debug actions in the default settings menu', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn(() => null)
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    const { registerSettingsMenu } = await import('../../src/userscript/settings-menu')

    registerSettingsMenu()
    await registerMenuCommand.mock.calls[0][1]()

    expect(prompt).toHaveBeenCalledWith(expect.not.stringContaining('调试日志'), '1')
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
    const prompt = vi.fn().mockReturnValueOnce('3').mockReturnValueOnce('4')
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

  it('sets the submit delay through the top-level settings menu', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn().mockReturnValueOnce('4').mockReturnValueOnce('2000-4500')
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { registerSettingsMenu } = await import('../../src/userscript/settings-menu')

    registerSettingsMenu()
    await registerMenuCommand.mock.calls[0][1]()

    expect(prompt).toHaveBeenNthCalledWith(1, expect.stringContaining('4. 设置提交前等待时间'), '1')
    expect(prompt).toHaveBeenNthCalledWith(2, '请输入提交前等待毫秒数，或 min-max 范围', '3000-5000')
    expect(localStorage.getItem('hvPonySolverSubmitDelay')).toBe('2000-4500')
    expect(alert).toHaveBeenCalledWith('提交前等待时间已保存')
  })

  it('sets the answer interval through the top-level settings menu', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn().mockReturnValueOnce('5').mockReturnValueOnce('750')
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { registerSettingsMenu } = await import('../../src/userscript/settings-menu')

    registerSettingsMenu()
    await registerMenuCommand.mock.calls[0][1]()

    expect(prompt).toHaveBeenNthCalledWith(1, expect.stringContaining('5. 设置答题间隔'), '1')
    expect(prompt).toHaveBeenNthCalledWith(2, '请输入多选点击间隔毫秒数，或 min-max 范围', '1000-1500')
    expect(localStorage.getItem('hvPonySolverMultiClickDelay')).toBe('750')
    expect(alert).toHaveBeenCalledWith('答题间隔已保存')
  })
})
