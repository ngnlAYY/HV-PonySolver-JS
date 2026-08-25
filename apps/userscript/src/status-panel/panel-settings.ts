import {
  clearPanelHistoryLimit as clearCorePanelHistoryLimit,
  clearPanelPosition as clearCorePanelPosition,
  getPanelHistoryLimit as getCorePanelHistoryLimit,
  getPanelHistoryLimitSync as getCorePanelHistoryLimitSync,
  getPanelPosition as getCorePanelPosition,
  getPanelPositionSync as getCorePanelPositionSync,
  isPanelCompactMode as isCorePanelCompactMode,
  isPanelCompactModeSync as isCorePanelCompactModeSync,
  isPanelCspVisibilityRequired as isCorePanelCspVisibilityRequired,
  isPanelCspVisibilityRequiredSync as isCorePanelCspVisibilityRequiredSync,
  serializePanelPosition,
  setPanelCompactMode as setCorePanelCompactMode,
  setPanelCspVisibilityRequired as setCorePanelCspVisibilityRequired,
  setPanelHistoryLimit as setCorePanelHistoryLimit,
  setPanelPosition as setCorePanelPosition,
  type PanelPosition,
} from '@hv-pony-solver/browser-core'

import { alertUser, promptUser } from '../userscript/gm-bridge'
import { gmSettingsStorage } from '../userscript/gm-storage'

export type { PanelPosition }

export function getPanelPositionSync(): PanelPosition {
  return getCorePanelPositionSync(gmSettingsStorage)
}

export function getPanelPosition(): Promise<PanelPosition> {
  return getCorePanelPosition(gmSettingsStorage)
}

export function setPanelPosition(value: string): Promise<void> {
  return setCorePanelPosition(gmSettingsStorage, value)
}

export function clearPanelPosition(): Promise<void> {
  return clearCorePanelPosition(gmSettingsStorage)
}

export function isPanelCompactModeSync(): boolean {
  return isCorePanelCompactModeSync(gmSettingsStorage)
}

export function isPanelCompactMode(): Promise<boolean> {
  return isCorePanelCompactMode(gmSettingsStorage)
}

export function setPanelCompactMode(enabled: boolean): Promise<void> {
  return setCorePanelCompactMode(gmSettingsStorage, enabled)
}

export function clearPanelCompactMode(): Promise<void> {
  return setCorePanelCompactMode(gmSettingsStorage, false)
}

export function isPanelCspVisibilityRequiredSync(): boolean {
  return isCorePanelCspVisibilityRequiredSync(gmSettingsStorage)
}

export function isPanelCspVisibilityRequired(): Promise<boolean> {
  return isCorePanelCspVisibilityRequired(gmSettingsStorage)
}

export function setPanelCspVisibilityRequired(enabled: boolean): Promise<void> {
  return setCorePanelCspVisibilityRequired(gmSettingsStorage, enabled)
}

export function getPanelHistoryLimitSync(): number {
  return getCorePanelHistoryLimitSync(gmSettingsStorage)
}

export function getPanelHistoryLimit(): Promise<number> {
  return getCorePanelHistoryLimit(gmSettingsStorage)
}

export function setPanelHistoryLimit(value: string): Promise<void> {
  return setCorePanelHistoryLimit(gmSettingsStorage, value)
}

export function clearPanelHistoryLimit(): Promise<void> {
  return clearCorePanelHistoryLimit(gmSettingsStorage)
}

export async function setPanelPositionFromPrompt(): Promise<void> {
  const currentPosition = await getPanelPosition()
  const input = promptUser('请输入面板位置 top,left，例如 155,1240', serializePanelPosition(currentPosition))
  if (input === null) {
    return
  }
  await setPanelPosition(input)
  alertUser('面板位置已保存，刷新页面后生效')
}

export async function clearSavedPanelPosition(): Promise<void> {
  await clearPanelPosition()
  alertUser('面板位置已重置，刷新页面后生效')
}

export async function enablePanelCompactMode(): Promise<void> {
  await setPanelCompactMode(true)
  alertUser('精简版已开启，刷新页面后生效')
}

export async function disablePanelCompactMode(): Promise<void> {
  await clearPanelCompactMode()
  alertUser('精简版已关闭，刷新页面后生效')
}

export async function enablePanelCspVisibilityLimit(): Promise<void> {
  await setPanelCspVisibilityRequired(true)
  alertUser('面板显示限制已开启，刷新页面后生效')
}

export async function disablePanelCspVisibilityLimit(): Promise<void> {
  await setPanelCspVisibilityRequired(false)
  alertUser('面板显示限制已关闭，刷新页面后生效')
}

export async function setPanelHistoryLimitFromPrompt(): Promise<void> {
  const currentLimit = await getPanelHistoryLimit()
  const input = promptUser('请输入答题记录显示条数，1 到 50', String(currentLimit))
  if (input === null) {
    return
  }
  await setPanelHistoryLimit(input)
  alertUser('答题记录显示条数已保存，刷新页面后生效')
}
