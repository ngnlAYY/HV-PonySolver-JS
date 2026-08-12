import type { SettingsStorage } from '../platform/storage'

export const PANEL_POSITION_STORAGE_KEY = 'hvPonySolverPanelPosition'
export const PANEL_COMPACT_MODE_STORAGE_KEY = 'hvPonySolverPanelCompact'
export const PANEL_HISTORY_LIMIT_STORAGE_KEY = 'hvPonySolverHistoryLimit'
export const DEFAULT_PANEL_POSITION: PanelPosition = { top: 150, left: 1240 }
export const DEFAULT_PANEL_HISTORY_LIMIT = 5
const INVALID_POSITION_MESSAGE = '面板位置格式无效，请输入非负整数 top,left，例如 150,1240'
const INVALID_HISTORY_LIMIT_MESSAGE = '答题记录条数无效，请输入 1 到 50 之间的整数'

export type PanelPosition = Readonly<{
  top: number
  left: number
}>

export function parsePanelPosition(value: string): PanelPosition {
  const match = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(value)
  if (!match) {
    throw new Error(INVALID_POSITION_MESSAGE)
  }
  return { top: Number(match[1]), left: Number(match[2]) }
}

export function serializePanelPosition(position: PanelPosition): string {
  return `${position.top},${position.left}`
}

export function parsePanelHistoryLimit(value: string): number {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(INVALID_HISTORY_LIMIT_MESSAGE)
  }
  const limit = Number(trimmed)
  if (limit < 1 || limit > 50) {
    throw new Error(INVALID_HISTORY_LIMIT_MESSAGE)
  }
  return limit
}

export function getPanelPositionSync(storage: SettingsStorage): PanelPosition {
  try {
    const saved = storage.getSync(PANEL_POSITION_STORAGE_KEY)
    return saved ? parsePanelPosition(saved) : DEFAULT_PANEL_POSITION
  } catch {
    return DEFAULT_PANEL_POSITION
  }
}

export async function getPanelPosition(storage: SettingsStorage): Promise<PanelPosition> {
  try {
    const saved = await storage.get(PANEL_POSITION_STORAGE_KEY)
    return saved ? parsePanelPosition(saved) : DEFAULT_PANEL_POSITION
  } catch {
    return DEFAULT_PANEL_POSITION
  }
}

export async function setPanelPosition(storage: SettingsStorage, value: string): Promise<void> {
  await storage.set(PANEL_POSITION_STORAGE_KEY, serializePanelPosition(parsePanelPosition(value)))
}

export async function clearPanelPosition(storage: SettingsStorage): Promise<void> {
  await storage.remove(PANEL_POSITION_STORAGE_KEY)
}

export function isPanelCompactModeSync(storage: SettingsStorage): boolean {
  try {
    return storage.getSync(PANEL_COMPACT_MODE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export async function isPanelCompactMode(storage: SettingsStorage): Promise<boolean> {
  try {
    return (await storage.get(PANEL_COMPACT_MODE_STORAGE_KEY)) === '1'
  } catch {
    return false
  }
}

export async function setPanelCompactMode(storage: SettingsStorage, enabled: boolean): Promise<void> {
  if (enabled) {
    await storage.set(PANEL_COMPACT_MODE_STORAGE_KEY, '1')
    return
  }
  await storage.remove(PANEL_COMPACT_MODE_STORAGE_KEY)
}

export async function getPanelHistoryLimit(storage: SettingsStorage): Promise<number> {
  try {
    const saved = await storage.get(PANEL_HISTORY_LIMIT_STORAGE_KEY)
    return saved ? parsePanelHistoryLimit(saved) : DEFAULT_PANEL_HISTORY_LIMIT
  } catch {
    return DEFAULT_PANEL_HISTORY_LIMIT
  }
}

export function getPanelHistoryLimitSync(storage: SettingsStorage): number {
  try {
    const saved = storage.getSync(PANEL_HISTORY_LIMIT_STORAGE_KEY)
    return saved ? parsePanelHistoryLimit(saved) : DEFAULT_PANEL_HISTORY_LIMIT
  } catch {
    return DEFAULT_PANEL_HISTORY_LIMIT
  }
}

export async function setPanelHistoryLimit(storage: SettingsStorage, value: string): Promise<void> {
  await storage.set(PANEL_HISTORY_LIMIT_STORAGE_KEY, String(parsePanelHistoryLimit(value)))
}

export async function clearPanelHistoryLimit(storage: SettingsStorage): Promise<void> {
  await storage.remove(PANEL_HISTORY_LIMIT_STORAGE_KEY)
}
