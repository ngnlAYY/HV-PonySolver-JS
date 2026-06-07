import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'hvPonySolverPanelPosition'
const COMPACT_STORAGE_KEY = 'hvPonySolverPanelCompact'

describe('panel settings', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  describe('getPanelPositionSync', () => {
    it('returns the default position when no position is saved', async () => {
      const { getPanelPositionSync } = await import('../../src/status-panel/panel-settings')

      expect(getPanelPositionSync()).toEqual({ top: 150, left: 1240 })
    })

    it('parses a valid position from localStorage', async () => {
      localStorage.setItem('hvPonySolverPanelPosition', '200,900')
      const { getPanelPositionSync } = await import('../../src/status-panel/panel-settings')

      expect(getPanelPositionSync()).toEqual({ top: 200, left: 900 })
    })

    it('returns the default position when the stored value is invalid', async () => {
      localStorage.setItem('hvPonySolverPanelPosition', 'not-valid')
      const { getPanelPositionSync } = await import('../../src/status-panel/panel-settings')

      expect(getPanelPositionSync()).toEqual({ top: 150, left: 1240 })
    })

    it('returns the default position when localStorage throws', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage error')
      })
      const { getPanelPositionSync } = await import('../../src/status-panel/panel-settings')

      expect(getPanelPositionSync()).toEqual({ top: 150, left: 1240 })
    })
  })

  it('reads the default position when no position is saved', async () => {
    const { getPanelPosition } = await import('../../src/status-panel/panel-settings')

    await expect(getPanelPosition()).resolves.toEqual({ top: 150, left: 1240 })
  })

  it('trims and persists panel position through localStorage fallback', async () => {
    const { getPanelPosition, setPanelPosition } = await import('../../src/status-panel/panel-settings')

    await setPanelPosition(' 200, 900 ')

    expect(localStorage.getItem(STORAGE_KEY)).toBe('200,900')
    await expect(getPanelPosition()).resolves.toEqual({ top: 200, left: 900 })
  })

  it('rejects invalid panel position input', async () => {
    const { setPanelPosition } = await import('../../src/status-panel/panel-settings')

    await expect(setPanelPosition('top:200;left:900')).rejects.toThrow('面板位置格式无效，请输入非负整数 top,left，例如 150,1240')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('clears saved panel position through localStorage fallback', async () => {
    const { clearPanelPosition, getPanelPosition, setPanelPosition } = await import('../../src/status-panel/panel-settings')

    await setPanelPosition('200,900')
    await clearPanelPosition()

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    await expect(getPanelPosition()).resolves.toEqual({ top: 150, left: 1240 })
  })

  it('reads compact mode from localStorage fallback', async () => {
    localStorage.setItem(COMPACT_STORAGE_KEY, '1')
    const { isPanelCompactMode, isPanelCompactModeSync } = await import('../../src/status-panel/panel-settings')

    expect(isPanelCompactModeSync()).toBe(true)
    await expect(isPanelCompactMode()).resolves.toBe(true)
  })

  it('persists and clears compact mode through localStorage fallback', async () => {
    const { clearPanelCompactMode, isPanelCompactMode, setPanelCompactMode } = await import('../../src/status-panel/panel-settings')

    await setPanelCompactMode(true)
    expect(localStorage.getItem(COMPACT_STORAGE_KEY)).toBe('1')
    await expect(isPanelCompactMode()).resolves.toBe(true)

    await clearPanelCompactMode()
    expect(localStorage.getItem(COMPACT_STORAGE_KEY)).toBeNull()
    await expect(isPanelCompactMode()).resolves.toBe(false)
  })

  it('uses GM storage for compact mode when available', async () => {
    const getValue = vi.fn(async () => '1')
    const setValue = vi.fn(async () => undefined)
    const deleteValue = vi.fn(async () => undefined)
    vi.stubGlobal('GM_getValue', getValue)
    vi.stubGlobal('GM_setValue', setValue)
    vi.stubGlobal('GM_deleteValue', deleteValue)
    const { clearPanelCompactMode, isPanelCompactMode, setPanelCompactMode } = await import('../../src/status-panel/panel-settings')

    await expect(isPanelCompactMode()).resolves.toBe(true)
    await setPanelCompactMode(true)
    await clearPanelCompactMode()

    expect(getValue).toHaveBeenCalledWith(COMPACT_STORAGE_KEY, '')
    expect(setValue).toHaveBeenCalledWith(COMPACT_STORAGE_KEY, '1')
    expect(deleteValue).toHaveBeenCalledWith(COMPACT_STORAGE_KEY)
  })

  it('uses GM storage when available', async () => {
    const getValue = vi.fn(async () => '200,900')
    const setValue = vi.fn(async () => undefined)
    const deleteValue = vi.fn(async () => undefined)
    vi.stubGlobal('GM_getValue', getValue)
    vi.stubGlobal('GM_setValue', setValue)
    vi.stubGlobal('GM_deleteValue', deleteValue)
    const { clearPanelPosition, getPanelPosition, setPanelPosition } = await import('../../src/status-panel/panel-settings')

    await expect(getPanelPosition()).resolves.toEqual({ top: 200, left: 900 })
    await setPanelPosition('300,1000')
    await clearPanelPosition()

    expect(getValue).toHaveBeenCalledWith(STORAGE_KEY, '')
    expect(setValue).toHaveBeenCalledWith(STORAGE_KEY, '300,1000')
    expect(deleteValue).toHaveBeenCalledWith(STORAGE_KEY)
  })

  it('falls back to the default position when storage read fails', async () => {
    const getValue = vi.fn(async () => {
      throw new Error('read failed')
    })
    vi.stubGlobal('GM_getValue', getValue)
    const { getPanelPosition } = await import('../../src/status-panel/panel-settings')

    await expect(getPanelPosition()).resolves.toEqual({ top: 150, left: 1240 })
  })

  it('registers no menu commands when the userscript menu API is unavailable', async () => {
    const { registerPanelSettingsMenu } = await import('../../src/status-panel/panel-settings')

    expect(() => registerPanelSettingsMenu()).not.toThrow()
  })

  it('registers set and reset menu commands when available', async () => {
    const registerMenuCommand = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    const { registerPanelSettingsMenu } = await import('../../src/status-panel/panel-settings')

    registerPanelSettingsMenu()

    expect(registerMenuCommand).toHaveBeenCalledTimes(4)
    expect(registerMenuCommand).toHaveBeenNthCalledWith(1, '设置面板位置', expect.any(Function))
    expect(registerMenuCommand).toHaveBeenNthCalledWith(2, '重置面板位置', expect.any(Function))
    expect(registerMenuCommand).toHaveBeenNthCalledWith(3, '开启精简版', expect.any(Function))
    expect(registerMenuCommand).toHaveBeenNthCalledWith(4, '关闭精简版', expect.any(Function))
  })

  it('keeps the existing position when the prompt is cancelled', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn(() => null)
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { getPanelPosition, registerPanelSettingsMenu, setPanelPosition } = await import('../../src/status-panel/panel-settings')

    await setPanelPosition('200,900')
    registerPanelSettingsMenu()
    await registerMenuCommand.mock.calls[0][1]()

    expect(prompt).toHaveBeenCalledWith('请输入面板位置 top,left，例如 150,1240', '200,900')
    await expect(getPanelPosition()).resolves.toEqual({ top: 200, left: 900 })
    expect(alert).not.toHaveBeenCalled()
  })

  it('saves a prompted panel position', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn(() => ' 250, 800 ')
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { getPanelPosition, registerPanelSettingsMenu } = await import('../../src/status-panel/panel-settings')

    registerPanelSettingsMenu()
    await registerMenuCommand.mock.calls[0][1]()

    await expect(getPanelPosition()).resolves.toEqual({ top: 250, left: 800 })
    expect(alert).toHaveBeenCalledWith('面板位置已保存，刷新页面后生效')
  })

  it('reports invalid prompted panel positions', async () => {
    const registerMenuCommand = vi.fn()
    const prompt = vi.fn(() => '-1,abc')
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('prompt', prompt)
    vi.stubGlobal('alert', alert)
    const { registerPanelSettingsMenu } = await import('../../src/status-panel/panel-settings')

    registerPanelSettingsMenu()
    await registerMenuCommand.mock.calls[0][1]()

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(alert).toHaveBeenCalledWith('面板位置设置失败: Error: 面板位置格式无效，请输入非负整数 top,left，例如 150,1240')
  })

  it('clears the position from the reset menu command', async () => {
    const registerMenuCommand = vi.fn()
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('alert', alert)
    const { getPanelPosition, registerPanelSettingsMenu, setPanelPosition } = await import('../../src/status-panel/panel-settings')

    await setPanelPosition('200,900')
    registerPanelSettingsMenu()
    await registerMenuCommand.mock.calls[1][1]()

    await expect(getPanelPosition()).resolves.toEqual({ top: 150, left: 1240 })
    expect(alert).toHaveBeenCalledWith('面板位置已重置，刷新页面后生效')
  })

  it('enables compact mode from the menu command', async () => {
    const registerMenuCommand = vi.fn()
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('alert', alert)
    const { isPanelCompactMode, registerPanelSettingsMenu } = await import('../../src/status-panel/panel-settings')

    registerPanelSettingsMenu()
    await registerMenuCommand.mock.calls[2][1]()

    await expect(isPanelCompactMode()).resolves.toBe(true)
    expect(alert).toHaveBeenCalledWith('精简版已开启，刷新页面后生效')
  })

  it('disables compact mode from the menu command', async () => {
    const registerMenuCommand = vi.fn()
    const alert = vi.fn()
    vi.stubGlobal('GM_registerMenuCommand', registerMenuCommand)
    vi.stubGlobal('alert', alert)
    const { isPanelCompactMode, registerPanelSettingsMenu, setPanelCompactMode } = await import('../../src/status-panel/panel-settings')

    await setPanelCompactMode(true)
    registerPanelSettingsMenu()
    await registerMenuCommand.mock.calls[3][1]()

    await expect(isPanelCompactMode()).resolves.toBe(false)
    expect(alert).toHaveBeenCalledWith('精简版已关闭，刷新页面后生效')
  })
})
