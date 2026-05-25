import { formatErrorMessage } from '../utils/errors'

const PANEL_POSITION_STORAGE_KEY = 'hvPonySolverPanelPosition'
const DEFAULT_PANEL_POSITION: PanelPosition = { top: 150, left: 1240 }
const INVALID_POSITION_MESSAGE = '面板位置格式无效，请输入非负整数 top,left，例如 150,1240'

type MaybePromise<T> = T | Promise<T>

type UserscriptGlobal = typeof globalThis & {
  GM_getValue?: (key: string, defaultValue: string) => MaybePromise<string>
  GM_setValue?: (key: string, value: string) => MaybePromise<void>
  GM_deleteValue?: (key: string) => MaybePromise<void>
  GM_registerMenuCommand?: (caption: string, command: () => void | Promise<void>) => void
}

export type PanelPosition = Readonly<{
  top: number
  left: number
}>

function getUserscriptGlobal(): UserscriptGlobal {
  return globalThis as UserscriptGlobal
}

function alertUser(message: string): void {
  globalThis.alert?.(message)
}

function runMenuAction(action: () => Promise<void>): Promise<void> {
  return action().catch((error) => {
    alertUser(`面板位置设置失败: ${formatErrorMessage(error)}`)
  })
}

function parsePanelPosition(value: string): PanelPosition {
  const match = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(value)
  if (!match) {
    throw new Error(INVALID_POSITION_MESSAGE)
  }
  return { top: Number(match[1]), left: Number(match[2]) }
}

function serializePanelPosition(position: PanelPosition): string {
  return `${position.top},${position.left}`
}

export async function getPanelPosition(): Promise<PanelPosition> {
  const userscriptGlobal = getUserscriptGlobal()
  try {
    const saved = typeof userscriptGlobal.GM_getValue === 'function'
      ? String(await userscriptGlobal.GM_getValue(PANEL_POSITION_STORAGE_KEY, ''))
      : globalThis.localStorage?.getItem(PANEL_POSITION_STORAGE_KEY) ?? ''
    if (!saved.trim()) {
      return DEFAULT_PANEL_POSITION
    }
    return parsePanelPosition(saved)
  } catch {
    return DEFAULT_PANEL_POSITION
  }
}

export async function setPanelPosition(value: string): Promise<void> {
  const position = parsePanelPosition(value)
  const serialized = serializePanelPosition(position)
  const userscriptGlobal = getUserscriptGlobal()
  if (typeof userscriptGlobal.GM_setValue === 'function') {
    await userscriptGlobal.GM_setValue(PANEL_POSITION_STORAGE_KEY, serialized)
    return
  }
  globalThis.localStorage?.setItem(PANEL_POSITION_STORAGE_KEY, serialized)
}

export async function clearPanelPosition(): Promise<void> {
  const userscriptGlobal = getUserscriptGlobal()
  if (typeof userscriptGlobal.GM_deleteValue === 'function') {
    await userscriptGlobal.GM_deleteValue(PANEL_POSITION_STORAGE_KEY)
    return
  }
  globalThis.localStorage?.removeItem(PANEL_POSITION_STORAGE_KEY)
}

export function registerPanelSettingsMenu(): void {
  const userscriptGlobal = getUserscriptGlobal()
  if (typeof userscriptGlobal.GM_registerMenuCommand !== 'function') {
    return
  }
  userscriptGlobal.GM_registerMenuCommand('设置面板位置', () => runMenuAction(setPanelPositionFromPrompt))
  userscriptGlobal.GM_registerMenuCommand('重置面板位置', () => runMenuAction(clearSavedPanelPosition))
}

async function setPanelPositionFromPrompt(): Promise<void> {
  const currentPosition = await getPanelPosition()
  const input = globalThis.prompt?.('请输入面板位置 top,left，例如 150,1240', serializePanelPosition(currentPosition))
  if (input === null || input === undefined) {
    return
  }
  await setPanelPosition(input)
  alertUser('面板位置已保存，刷新页面后生效')
}

async function clearSavedPanelPosition(): Promise<void> {
  await clearPanelPosition()
  alertUser('面板位置已重置，刷新页面后生效')
}
