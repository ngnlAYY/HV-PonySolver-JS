import { clearSavedModelAccessKey, setModelAccessKeyFromPrompt, type VerifyModelAccessKey } from '../model/model-settings'
import { clearSavedPanelPosition, disablePanelCompactMode, enablePanelCompactMode, setPanelHistoryLimitFromPrompt, setPanelPositionFromPrompt } from '../status-panel/panel-settings'
import { disableDebugLogging, enableDebugLogging } from './debug-settings'
import { promptUser, registerGmMenu, runMenuAction } from './gm-bridge'

export type SettingsMenuOptions = Readonly<{
  onVerifyModelAccessKey?: VerifyModelAccessKey
}>

type SettingsAction = Readonly<{
  label: string
  errorPrefix: string
  run: () => Promise<void>
}>

export function registerSettingsMenu(options: SettingsMenuOptions = {}): void {
  registerGmMenu('HV-PonySolver 设置', () => runMenuAction(() => chooseSettingsAction(options), '设置失败'))
}

async function chooseSettingsAction(options: SettingsMenuOptions): Promise<void> {
  const actions: SettingsAction[] = [
    { label: '设置模型下载 Key', errorPrefix: '模型下载 Key 设置失败', run: () => setModelAccessKeyFromPrompt(options.onVerifyModelAccessKey) },
    { label: '清除模型下载 Key', errorPrefix: '模型下载 Key 设置失败', run: clearSavedModelAccessKey },
    { label: '设置答题记录显示条数', errorPrefix: '答题记录显示条数设置失败', run: setPanelHistoryLimitFromPrompt },
    { label: '设置面板位置', errorPrefix: '面板位置设置失败', run: setPanelPositionFromPrompt },
    { label: '重置面板位置', errorPrefix: '面板位置设置失败', run: clearSavedPanelPosition },
    { label: '开启精简版', errorPrefix: '精简版设置失败', run: enablePanelCompactMode },
    { label: '关闭精简版', errorPrefix: '精简版设置失败', run: disablePanelCompactMode },
    { label: '开启调试日志', errorPrefix: '调试日志设置失败', run: enableDebugLogging },
    { label: '关闭调试日志', errorPrefix: '调试日志设置失败', run: disableDebugLogging },
  ]
  const input = promptUser(actions.map((action, index) => `${index + 1}. ${action.label}`).join('\n'), '1')
  if (input === null) {
    return
  }
  const selected = input.trim()
  const action = /^\d+$/.test(selected) ? actions[Number(selected) - 1] : undefined
  if (!action) {
    throw new Error('设置选项无效')
  }
  await runMenuAction(action.run, action.errorPrefix)
}
