import { formatErrorMessage } from '@hv-pony-solver/browser-core'

export type MaybePromise<T> = T | Promise<T>

export type SetGmValueOptions = Readonly<{
  /**
   * True for values a page must never read (model access keys): without GM
   * storage these refuse the same-origin localStorage fallback instead.
   */
  sensitive?: boolean
}>

type ModernGmApi = {
  getValue?: (key: string, defaultValue: string) => MaybePromise<unknown>
  setValue?: (key: string, value: string) => MaybePromise<void>
  deleteValue?: (key: string) => MaybePromise<void>
}

type UserscriptGlobal = typeof globalThis & {
  GM_getValue?: (key: string, defaultValue: string) => MaybePromise<string>
  GM_setValue?: (key: string, value: string) => MaybePromise<void>
  GM_deleteValue?: (key: string) => MaybePromise<void>
  GM_registerMenuCommand?: (caption: string, command: () => void | Promise<void>) => void
  GM?: ModernGmApi
}

function getUserscriptGlobal(): UserscriptGlobal {
  return globalThis as UserscriptGlobal
}

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      const storage = globalThis.localStorage
      if (!storage) {
        throw new Error('localStorage 不可用')
      }
      storage.setItem(key, value)
    } catch (error) {
      throw new Error(`本地存储写入失败: ${formatErrorMessage(error)}`, { cause: error })
    }
  },
  removeItem(key: string): void {
    try {
      const storage = globalThis.localStorage
      if (!storage) {
        throw new Error('localStorage 不可用')
      }
      storage.removeItem(key)
    } catch (error) {
      throw new Error(`本地存储删除失败: ${formatErrorMessage(error)}`, { cause: error })
    }
  },
}

export async function getGmValue(key: string, defaultValue = ''): Promise<string> {
  const userscriptGlobal = getUserscriptGlobal()
  const modernGm = userscriptGlobal.GM
  if (typeof modernGm?.getValue === 'function') {
    const value = await modernGm.getValue(key, defaultValue)
    return String(value ?? defaultValue).trim()
  }
  if (typeof userscriptGlobal.GM_getValue === 'function') {
    return String(await userscriptGlobal.GM_getValue(key, defaultValue)).trim()
  }
  return getGmValueSync(key, defaultValue)
}

export function getGmValueSync(key: string, defaultValue = ''): string {
  const userscriptGlobal = getUserscriptGlobal()
  if (typeof userscriptGlobal.GM_getValue === 'function') {
    const value = userscriptGlobal.GM_getValue(key, defaultValue)
    if (typeof value === 'string') {
      return value.trim()
    }
  }
  return (safeStorage.getItem(key) ?? defaultValue).trim()
}

export async function setGmValue(key: string, value: string, options: SetGmValueOptions = {}): Promise<void> {
  const userscriptGlobal = getUserscriptGlobal()
  const modernGm = userscriptGlobal.GM
  if (typeof modernGm?.setValue === 'function') {
    await modernGm.setValue(key, value)
    return
  }
  if (typeof userscriptGlobal.GM_setValue === 'function') {
    await userscriptGlobal.GM_setValue(key, value)
    return
  }
  if (options.sensitive) {
    throw new Error('当前脚本管理器不支持 GM 存储，无法安全保存模型下载 Key；请改用支持 GM_setValue 的用户脚本管理器')
  }
  safeStorage.setItem(key, value)
}

export async function deleteGmValue(key: string): Promise<void> {
  const userscriptGlobal = getUserscriptGlobal()
  const modernGm = userscriptGlobal.GM
  if (typeof modernGm?.deleteValue === 'function') {
    await modernGm.deleteValue(key)
    return
  }
  if (typeof userscriptGlobal.GM_deleteValue === 'function') {
    await userscriptGlobal.GM_deleteValue(key)
    return
  }
  safeStorage.removeItem(key)
}

export function registerGmMenu(caption: string, command: () => void | Promise<void>): boolean {
  const userscriptGlobal = getUserscriptGlobal()
  if (typeof userscriptGlobal.GM_registerMenuCommand !== 'function') {
    return false
  }
  userscriptGlobal.GM_registerMenuCommand(caption, command)
  return true
}

export function alertUser(message: string): void {
  globalThis.alert?.(message)
}

export function promptUser(message: string, defaultValue?: string): string | null {
  const result = globalThis.prompt?.(message, defaultValue)
  return result === null || result === undefined ? null : result
}

export async function runMenuAction(action: () => Promise<void>, errorPrefix: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    alertUser(`${errorPrefix}: ${formatErrorMessage(error)}`)
  }
}
