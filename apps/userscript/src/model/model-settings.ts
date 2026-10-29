import {
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
let keyIntentGeneration = 0
let keyMutationTail: Promise<void> = Promise.resolve()

function commitKeyMutation(mutate: () => Promise<void>): Promise<void> {
  // GM 写入不可撤销；后续设置/清除必须等旧写入结算，不能让旧值迟到覆盖新意图。
  const committed = keyMutationTail.then(mutate)
  keyMutationTail = committed.catch(() => undefined)
  return committed
}

export function getModelAccessKey(): Promise<string> {
  return getCoreModelAccessKey(modelAccessKeyStorage)
}

export async function setModelAccessKey(value: string, onCommitted?: ModelAccessKeyCommitted): Promise<void> {
  keyIntentGeneration += 1
  await commitKeyMutation(() => setCoreModelAccessKey(modelAccessKeyStorage, value))
  await onCommitted?.()
}

export async function clearModelAccessKey(onCommitted?: ModelAccessKeyCommitted): Promise<void> {
  keyIntentGeneration += 1
  await commitKeyMutation(() => clearCoreModelAccessKey(modelAccessKeyStorage))
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
  // 验证尚未写入 GM；新的设置/清除必须阻止旧验证迟到后恢复已淘汰的 Key。
  const generation = ++keyIntentGeneration
  alertUser('正在验证模型下载 Key，请稍候')
  try {
    await onVerify(accessKey)
  } catch (error) {
    if (generation !== keyIntentGeneration) return
    alertUser(`模型下载 Key 验证失败: ${formatErrorMessage(error)}`)
    return
  }
  if (generation !== keyIntentGeneration) return
  let committed = false
  await commitKeyMutation(async () => {
    // 排队等待旧 GM 写入时，新的验证也可能淘汰本次尚未提交的 Key。
    if (generation !== keyIntentGeneration) return
    await setCoreModelAccessKey(modelAccessKeyStorage, accessKey)
    committed = true
  })
  if (!committed) return
  await onCommitted?.()
  if (generation === keyIntentGeneration) alertUser('模型下载 Key 已验证并保存')
}

export async function clearSavedModelAccessKey(onCommitted?: ModelAccessKeyCommitted): Promise<void> {
  await clearModelAccessKey(onCommitted)
  alertUser('模型下载 Key 已清除')
}
