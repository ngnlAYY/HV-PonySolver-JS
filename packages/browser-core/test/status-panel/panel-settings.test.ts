import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PANEL_POSITION,
  MAX_PANEL_POSITION,
  getPanelPosition,
  getPanelPositionSync,
  parsePanelPosition,
  serializePanelPosition,
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
    const invalid = storage('999999999999999999999999,20')
    expect(getPanelPositionSync(invalid)).toEqual(DEFAULT_PANEL_POSITION)
    await expect(getPanelPosition(invalid)).resolves.toEqual(DEFAULT_PANEL_POSITION)
  })
})
