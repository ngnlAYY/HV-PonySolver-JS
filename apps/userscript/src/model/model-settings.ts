import {
  ModelDownloadQuotaExceededError,
  clearModelAccessKey as clearCoreModelAccessKey,
  formatErrorMessage,
  getModelAccessKey as getCoreModelAccessKey,
  setModelAccessKey as setCoreModelAccessKey,
} from '@hv-pony-solver/browser-core'

import { alertUser, promptUser } from '../userscript/gm-bridge'
import { gmSettingsStorage } from '../userscript/gm-storage'

export type VerifyModelAccessKey = (candidateKey: string) => Promise<void>

export function getModelAccessKey(): Promise<string> {
  return getCoreModelAccessKey(gmSettingsStorage)
}

export function setModelAccessKey(value: string): Promise<void> {
  return setCoreModelAccessKey(gmSettingsStorage, value)
}

export function clearModelAccessKey(): Promise<void> {
  return clearCoreModelAccessKey(gmSettingsStorage)
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
  if (!onVerify) {
    await setModelAccessKey(accessKey)
    alertUser('模型下载 Key 已保存')
    return
  }
  alertUser('正在验证模型下载 Key，请稍候')
  try {
    await onVerify(accessKey)
  } catch (error) {
    if (error instanceof ModelDownloadQuotaExceededError) {
      await setModelAccessKey(accessKey)
      alertUser(error.message)
      return
    }
    alertUser(`模型下载 Key 验证失败: ${formatErrorMessage(error)}`)
    return
  }
  await setModelAccessKey(accessKey)
  alertUser('模型下载和校验成功，Key 可用')
}

export async function clearSavedModelAccessKey(): Promise<void> {
  await clearModelAccessKey()
  alertUser('模型下载 Key 已清除')
}
