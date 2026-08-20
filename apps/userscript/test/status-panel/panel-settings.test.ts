import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'hvPonySolverPanelPosition'
const COMPACT_STORAGE_KEY = 'hvPonySolverPanelCompact'
const HISTORY_LIMIT_STORAGE_KEY = 'hvPonySolverHistoryLimit'

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

  it('reads the default history limit when no value is saved', async () => {
    const { getPanelHistoryLimit, getPanelHistoryLimitSync } = await import('../../src/status-panel/panel-settings')

    expect(getPanelHistoryLimitSync()).toBe(5)
    await expect(getPanelHistoryLimit()).resolves.toBe(5)
  })

  it('persists and clears the history limit through localStorage fallback', async () => {
    const { clearPanelHistoryLimit, getPanelHistoryLimit, setPanelHistoryLimit } = await import('../../src/status-panel/panel-settings')

    await setPanelHistoryLimit('3')
    expect(localStorage.getItem(HISTORY_LIMIT_STORAGE_KEY)).toBe('3')
    await expect(getPanelHistoryLimit()).resolves.toBe(3)

    await clearPanelHistoryLimit()
    expect(localStorage.getItem(HISTORY_LIMIT_STORAGE_KEY)).toBeNull()
    await expect(getPanelHistoryLimit()).resolves.toBe(5)
  })

  it('rejects invalid history limit input', async () => {
    const { setPanelHistoryLimit } = await import('../../src/status-panel/panel-settings')

    await expect(setPanelHistoryLimit('0')).rejects.toThrow('答题记录条数无效，请输入 1 到 50 之间的整数')
    await expect(setPanelHistoryLimit('abc')).rejects.toThrow('答题记录条数无效，请输入 1 到 50 之间的整数')
    await expect(setPanelHistoryLimit('1e1')).rejects.toThrow('答题记录条数无效，请输入 1 到 50 之间的整数')
    await expect(setPanelHistoryLimit('0x10')).rejects.toThrow('答题记录条数无效，请输入 1 到 50 之间的整数')
    expect(localStorage.getItem(HISTORY_LIMIT_STORAGE_KEY)).toBeNull()
  })

})
