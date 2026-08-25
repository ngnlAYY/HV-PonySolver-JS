import { setAnswerModeFromPrompt } from '../captcha/answer-mode-settings'
import { setMultiClickDelayRangeFromPrompt, setSubmitDelayRangeFromPrompt } from '../captcha/timing-settings'
import {
  clearSavedModelAccessKey,
  querySavedModelDownloadQuota,
  setModelAccessKeyFromPrompt,
  type VerifyModelAccessKey,
} from '../model/model-settings'
import {
  clearSavedPanelPosition,
  disablePanelCspVisibilityLimit,
  disablePanelCompactMode,
  enablePanelCspVisibilityLimit,
  enablePanelCompactMode,
  setPanelHistoryLimitFromPrompt,
  setPanelPositionFromPrompt,
} from '../status-panel/panel-settings'
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
    {
      label: '设置模型下载 Key',
      errorPrefix: '模型下载 Key 设置失败',
      run: () => setModelAccessKeyFromPrompt(options.onVerifyModelAccessKey),
    },
    { label: '清除模型下载 Key', errorPrefix: '模型下载 Key 设置失败', run: clearSavedModelAccessKey },
    { label: '设置答题模式', errorPrefix: '答题模式设置失败', run: setAnswerModeFromPrompt },
    { label: '设置答题记录显示条数', errorPrefix: '答题记录显示条数设置失败', run: setPanelHistoryLimitFromPrompt },
    { label: '设置提交前等待时间', errorPrefix: '提交前等待时间设置失败', run: setSubmitDelayRangeFromPrompt },
    { label: '设置答题间隔', errorPrefix: '答题间隔设置失败', run: setMultiClickDelayRangeFromPrompt },
    { label: '设置面板位置', errorPrefix: '面板位置设置失败', run: setPanelPositionFromPrompt },
    { label: '重置面板位置', errorPrefix: '面板位置设置失败', run: clearSavedPanelPosition },
    { label: '开启精简版', errorPrefix: '精简版设置失败', run: enablePanelCompactMode },
    { label: '关闭精简版', errorPrefix: '精简版设置失败', run: disablePanelCompactMode },
    { label: '查询模型下载次数', errorPrefix: '模型下载次数查询失败', run: querySavedModelDownloadQuota },
    { label: '仅在验证码窗口出现时显示面板', errorPrefix: '面板显示限制设置失败', run: enablePanelCspVisibilityLimit },
    { label: '始终显示面板', errorPrefix: '面板显示限制设置失败', run: disablePanelCspVisibilityLimit },
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
