import { formatErrorMessage } from '../utils/errors'

const MODEL_ACCESS_KEY_STORAGE_KEY = 'hvPonySolverModelAccessKey'

type MaybePromise<T> = T | Promise<T>

type UserscriptGlobal = typeof globalThis & {
  GM_getValue?: (key: string, defaultValue: string) => MaybePromise<string>
  GM_setValue?: (key: string, value: string) => MaybePromise<void>
  GM_deleteValue?: (key: string) => MaybePromise<void>
  GM_registerMenuCommand?: (caption: string, command: () => void | Promise<void>) => void
}

type VerifyModelAccessKey = () => Promise<void>

function getUserscriptGlobal(): UserscriptGlobal {
  return globalThis as UserscriptGlobal
}

function alertUser(message: string): void {
  globalThis.alert?.(message)
}

function runMenuAction(action: () => Promise<void>): Promise<void> {
  return action().catch((error) => {
    alertUser(`模型下载 Key 设置失败: ${formatErrorMessage(error)}`)
  })
}

export async function getModelAccessKey(): Promise<string> {
  const userscriptGlobal = getUserscriptGlobal()
  if (typeof userscriptGlobal.GM_getValue === 'function') {
    return String(await userscriptGlobal.GM_getValue(MODEL_ACCESS_KEY_STORAGE_KEY, '')).trim()
  }
  return globalThis.localStorage?.getItem(MODEL_ACCESS_KEY_STORAGE_KEY)?.trim() ?? ''
}

export async function setModelAccessKey(value: string): Promise<void> {
  const accessKey = value.trim()
  const userscriptGlobal = getUserscriptGlobal()
  if (typeof userscriptGlobal.GM_setValue === 'function') {
    await userscriptGlobal.GM_setValue(MODEL_ACCESS_KEY_STORAGE_KEY, accessKey)
    return
  }
  globalThis.localStorage?.setItem(MODEL_ACCESS_KEY_STORAGE_KEY, accessKey)
}

export async function clearModelAccessKey(): Promise<void> {
  const userscriptGlobal = getUserscriptGlobal()
  if (typeof userscriptGlobal.GM_deleteValue === 'function') {
    await userscriptGlobal.GM_deleteValue(MODEL_ACCESS_KEY_STORAGE_KEY)
    return
  }
  globalThis.localStorage?.removeItem(MODEL_ACCESS_KEY_STORAGE_KEY)
}

export function registerModelSettingsMenu(onVerify?: VerifyModelAccessKey): void {
  const userscriptGlobal = getUserscriptGlobal()
  if (typeof userscriptGlobal.GM_registerMenuCommand !== 'function') {
    return
  }
  userscriptGlobal.GM_registerMenuCommand('设置模型下载 Key', () => runMenuAction(() => setModelAccessKeyFromPrompt(onVerify)))
  userscriptGlobal.GM_registerMenuCommand('清除模型下载 Key', () => runMenuAction(clearSavedModelAccessKey))
}

async function setModelAccessKeyFromPrompt(onVerify?: VerifyModelAccessKey): Promise<void> {
  const currentKey = await getModelAccessKey()
  const input = globalThis.prompt?.('请输入模型下载 Key', currentKey)
  if (input === null || input === undefined) {
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

async function clearSavedModelAccessKey(): Promise<void> {
  await clearModelAccessKey()
  alertUser('模型下载 Key 已清除')
}
