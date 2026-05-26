import { alertUser, deleteGmValue, getGmValueSync, registerGmMenu, runMenuAction, setGmValue } from './gm-bridge'

export const DEBUG_STORAGE_KEY = 'hvPonySolverDebug'

export function isDebugEnabled(): boolean {
  return getGmValueSync(DEBUG_STORAGE_KEY) === '1'
}

async function enableDebugLogging(): Promise<void> {
  await setGmValue(DEBUG_STORAGE_KEY, '1')
  alertUser('调试日志已开启')
}

async function disableDebugLogging(): Promise<void> {
  await deleteGmValue(DEBUG_STORAGE_KEY)
  alertUser('调试日志已关闭')
}

export function registerDebugSettingsMenu(): void {
  registerGmMenu('开启调试日志', () => runMenuAction(enableDebugLogging, '调试日志设置失败'))
  registerGmMenu('关闭调试日志', () => runMenuAction(disableDebugLogging, '调试日志设置失败'))
}
