import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PANEL_POSITION,
  MAX_PANEL_POSITION,
  getPanelPosition,
  getPanelPositionSync,
  isPanelCspVisibilityRequired,
  isPanelCspVisibilityRequiredSync,
  parsePanelPosition,
  serializePanelPosition,
  setPanelCspVisibilityRequired,
} from '../../src/status-panel/panel-settings'
import type { SettingsStorage } from '../../src/platform/storage'

function storage(initial: string | null): SettingsStorage {
  return {
    getSync: () => initial,
    get: async () => initial,
    set: async () => undefined,
    remove: async () => undefined,
  }
}

describe('panel position parser', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('round-trips safe coordinates within the configured range', () => {
    const position = { top: MAX_PANEL_POSITION, left: 0 }
    expect(parsePanelPosition(serializePanelPosition(position))).toEqual(position)
  })

  it('rejects unsafe, non-finite, and unreasonably large coordinates', () => {
    expect(() => parsePanelPosition('9007199254740992,20')).toThrow('面板位置格式无效')
    expect(() => parsePanelPosition('999999999999999999999999,20')).toThrow('面板位置格式无效')
    expect(() => serializePanelPosition({ top: Infinity, left: 20 })).toThrow('面板位置格式无效')
    expect(() => serializePanelPosition({ top: Number.MAX_SAFE_INTEGER + 1, left: 20 })).toThrow('面板位置格式无效')
    expect(() => serializePanelPosition({ top: MAX_PANEL_POSITION + 1, left: 20 })).toThrow('面板位置格式无效')
  })

  it('falls back when a stored coordinate cannot be represented safely', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const invalid = storage('999999999999999999999999,20')
    expect(getPanelPositionSync(invalid)).toEqual(DEFAULT_PANEL_POSITION)
    await expect(getPanelPosition(invalid)).resolves.toEqual(DEFAULT_PANEL_POSITION)
    expect(warnSpy).toHaveBeenCalledWith(
      '[PonySolverLocal]',
      '读取面板位置设置失败，使用默认值:',
      'Error: 面板位置格式无效，请输入非负整数 top,left，例如 155,1240',
    )
  })

  it('warns when the synchronous position read itself throws', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const unavailable: SettingsStorage = {
      ...storage(null),
      getSync: () => {
        throw new Error('storage unavailable')
      },
    }

    expect(getPanelPositionSync(unavailable)).toEqual(DEFAULT_PANEL_POSITION)
    expect(warnSpy).toHaveBeenCalledWith(
      '[PonySolverLocal]',
      '读取面板位置设置失败，使用默认值:',
      'Error: storage unavailable',
    )
  })

  it('requires div#csp by default and persists an explicit visibility opt-out', async () => {
    expect(isPanelCspVisibilityRequiredSync(storage(null))).toBe(true)
    await expect(isPanelCspVisibilityRequired(storage(null))).resolves.toBe(true)
    expect(isPanelCspVisibilityRequiredSync(storage('0'))).toBe(false)

    const set = vi.fn(async () => undefined)
    await setPanelCspVisibilityRequired({ ...storage(null), set }, false)
    expect(set).toHaveBeenCalledWith('hvPonySolverPanelRequireCsp', '0')
  })
})
