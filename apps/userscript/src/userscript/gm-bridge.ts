import { formatErrorMessage } from '../utils/errors'

export type MaybePromise<T> = T | Promise<T>

type UserscriptGlobal = typeof globalThis & {
  GM_getValue?: (key: string, defaultValue: string) => MaybePromise<string>
  GM_setValue?: (key: string, value: string) => MaybePromise<void>
  GM_deleteValue?: (key: string) => MaybePromise<void>
  GM_registerMenuCommand?: (caption: string, command: () => void | Promise<void>) => void
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
      globalThis.localStorage?.setItem(key, value)
    } catch {
      return
    }
  },
  removeItem(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key)
    } catch {
      return
    }
  },
}

export async function getGmValue(key: string, defaultValue = ''): Promise<string> {
  const userscriptGlobal = getUserscriptGlobal()
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

export async function setGmValue(key: string, value: string): Promise<void> {
  const userscriptGlobal = getUserscriptGlobal()
  if (typeof userscriptGlobal.GM_setValue === 'function') {
    await userscriptGlobal.GM_setValue(key, value)
    return
  }
  safeStorage.setItem(key, value)
}

export async function deleteGmValue(key: string): Promise<void> {
  const userscriptGlobal = getUserscriptGlobal()
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
