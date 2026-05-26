import { alertUser, deleteGmValue, getGmValue, getGmValueSync, promptUser, registerGmMenu, runMenuAction, setGmValue } from '../userscript/gm-bridge'

const PANEL_POSITION_STORAGE_KEY = 'hvPonySolverPanelPosition'
const DEFAULT_PANEL_POSITION: PanelPosition = { top: 150, left: 1240 }
const INVALID_POSITION_MESSAGE = '面板位置格式无效，请输入非负整数 top,left，例如 150,1240'

export type PanelPosition = Readonly<{
  top: number
  left: number
}>

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

export function getPanelPositionSync(): PanelPosition {
  try {
    const saved = getGmValueSync(PANEL_POSITION_STORAGE_KEY)
    if (!saved) {
      return DEFAULT_PANEL_POSITION
    }
    return parsePanelPosition(saved)
  } catch {
    return DEFAULT_PANEL_POSITION
  }
}

export async function getPanelPosition(): Promise<PanelPosition> {
  try {
    const saved = await getGmValue(PANEL_POSITION_STORAGE_KEY)
    if (!saved) {
      return DEFAULT_PANEL_POSITION
    }
    return parsePanelPosition(saved)
  } catch {
    return DEFAULT_PANEL_POSITION
  }
}

export async function setPanelPosition(value: string): Promise<void> {
  const position = parsePanelPosition(value)
  await setGmValue(PANEL_POSITION_STORAGE_KEY, serializePanelPosition(position))
}

export async function clearPanelPosition(): Promise<void> {
  await deleteGmValue(PANEL_POSITION_STORAGE_KEY)
}

export function registerPanelSettingsMenu(): void {
  registerGmMenu('设置面板位置', () => runMenuAction(setPanelPositionFromPrompt, '面板位置设置失败'))
  registerGmMenu('重置面板位置', () => runMenuAction(clearSavedPanelPosition, '面板位置设置失败'))
}

async function setPanelPositionFromPrompt(): Promise<void> {
  const currentPosition = await getPanelPosition()
  const input = promptUser('请输入面板位置 top,left，例如 150,1240', serializePanelPosition(currentPosition))
  if (input === null) {
    return
  }
  await setPanelPosition(input)
  alertUser('面板位置已保存，刷新页面后生效')
}

async function clearSavedPanelPosition(): Promise<void> {
  await clearPanelPosition()
  alertUser('面板位置已重置，刷新页面后生效')
}
