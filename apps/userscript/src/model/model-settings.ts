import { formatErrorMessage } from '../utils/errors'
import { alertUser, deleteGmValue, getGmValue, promptUser, registerGmMenu, runMenuAction, setGmValue } from '../userscript/gm-bridge'

const MODEL_ACCESS_KEY_STORAGE_KEY = 'hvPonySolverModelAccessKey'

export type VerifyModelAccessKey = () => Promise<void>

export async function getModelAccessKey(): Promise<string> {
  return getGmValue(MODEL_ACCESS_KEY_STORAGE_KEY)
}

export async function setModelAccessKey(value: string): Promise<void> {
  await setGmValue(MODEL_ACCESS_KEY_STORAGE_KEY, value.trim())
}

export async function clearModelAccessKey(): Promise<void> {
  await deleteGmValue(MODEL_ACCESS_KEY_STORAGE_KEY)
}

export function registerModelSettingsMenu(onVerify?: VerifyModelAccessKey): void {
  registerGmMenu('设置模型下载 Key', () => runMenuAction(() => setModelAccessKeyFromPrompt(onVerify), '模型下载 Key 设置失败'))
  registerGmMenu('清除模型下载 Key', () => runMenuAction(clearSavedModelAccessKey, '模型下载 Key 设置失败'))
}

export async function setModelAccessKeyFromPrompt(onVerify?: VerifyModelAccessKey): Promise<void> {
  const input = promptUser('请输入模型下载 Key（已设置时不会回填原值；留空会清除）', '')
  if (input === null) {
    return
  }
  const accessKey = input.trim()
  if (!accessKey) {
    await clearModelAccessKey()
    alertUser('模型下载 Key 已清除')
    return
  }
  await setModelAccessKey(accessKey)
  if (!onVerify) {
    alertUser('模型下载 Key 已保存')
    return
  }
  alertUser('正在验证模型下载 Key，请稍候')
  try {
    await onVerify()
    alertUser('模型下载和校验成功，Key 可用')
  } catch (error) {
    alertUser(`模型下载 Key 验证失败: ${formatErrorMessage(error)}`)
  }
}

export async function clearSavedModelAccessKey(): Promise<void> {
  await clearModelAccessKey()
  alertUser('模型下载 Key 已清除')
}
