import {
  ModelDownloadQuotaExceededError,
  clearModelAccessKey as clearCoreModelAccessKey,
  formatErrorMessage,
  getModelAccessKey as getCoreModelAccessKey,
  queryModelDownloadQuota as queryCoreModelDownloadQuota,
  setModelAccessKey as setCoreModelAccessKey,
} from '@hv-pony-solver/browser-core'

import { alertUser, promptUser } from '../userscript/gm-bridge'
import { sensitiveGmSettingsStorage } from '../userscript/gm-storage'

export type VerifyModelAccessKey = (candidateKey: string) => Promise<void>
export type ModelAccessKeyCommitted = () => void | Promise<void>

// The model access key is a credential: it is stored only through GM storage,
// never through the page-readable localStorage fallback.
const modelAccessKeyStorage = sensitiveGmSettingsStorage

export function getModelAccessKey(): Promise<string> {
  return getCoreModelAccessKey(modelAccessKeyStorage)
}

export async function setModelAccessKey(value: string, onCommitted?: ModelAccessKeyCommitted): Promise<void> {
  await setCoreModelAccessKey(modelAccessKeyStorage, value)
  await onCommitted?.()
}

export async function clearModelAccessKey(onCommitted?: ModelAccessKeyCommitted): Promise<void> {
  await clearCoreModelAccessKey(modelAccessKeyStorage)
  await onCommitted?.()
}

export async function querySavedModelDownloadQuota(): Promise<void> {
  const quota = await queryCoreModelDownloadQuota(undefined, {}, { getAccessKey: () => getModelAccessKey() })
  if (!quota.enabled) {
    alertUser('无次数限制（模型下载次数限制未开启）')
    return
  }
  alertUser(`本月模型下载额度：已用 ${quota.used}/${quota.limit} 次，剩余 ${quota.remaining ?? 0} 次`)
}

export async function setModelAccessKeyFromPrompt(
  onVerify?: VerifyModelAccessKey,
  onCommitted?: ModelAccessKeyCommitted,
): Promise<void> {
  const input = promptUser('请输入模型下载 Key（已设置时不会回填原值；留空会清除）', '')
  if (input === null) {
    return
  }
  const accessKey = input.trim()
  if (!accessKey) {
    await clearModelAccessKey(onCommitted)
    alertUser('模型下载 Key 已清除')
    return
  }
  if (!onVerify) {
    await setModelAccessKey(accessKey, onCommitted)
    alertUser('模型下载 Key 已保存')
    return
  }
  alertUser('正在验证模型下载 Key，请稍候')
  try {
    await onVerify(accessKey)
  } catch (error) {
    if (error instanceof ModelDownloadQuotaExceededError) {
      await setModelAccessKey(accessKey, onCommitted)
      alertUser(error.message)
      return
    }
    alertUser(`模型下载 Key 验证失败: ${formatErrorMessage(error)}`)
    return
  }
  await setModelAccessKey(accessKey, onCommitted)
  alertUser('模型下载 Key 已验证并保存')
}

export async function clearSavedModelAccessKey(onCommitted?: ModelAccessKeyCommitted): Promise<void> {
  await clearModelAccessKey(onCommitted)
  alertUser('模型下载 Key 已清除')
}
