import type { EnumerableTextStorage, SettingsStorage } from '@hv-pony-solver/browser-core'

import { deleteGmValue, getGmValue, getGmValueSync, safeStorage, setGmValue } from './gm-bridge'

export const gmSettingsStorage: SettingsStorage = {
  async get(key: string): Promise<string | null> {
    const value = await getGmValue(key)
    return value || null
  },
  getSync(key: string): string | null {
    const value = getGmValueSync(key)
    return value || null
  },
  async set(key: string, value: string): Promise<void> {
    await setGmValue(key, value)
  },
  async remove(key: string): Promise<void> {
    await deleteGmValue(key)
  },
}

/**
 * Settings storage for sensitive values (the model access key): writes refuse
 * the page-readable localStorage fallback when GM storage is unavailable.
 */
export const sensitiveGmSettingsStorage: SettingsStorage = {
  async get(key: string): Promise<string | null> {
    const value = await getGmValue(key, '', { sensitive: true })
    return value || null
  },
  getSync(key: string): string | null {
    const value = getGmValueSync(key, '', { sensitive: true })
    return value || null
  },
  async set(key: string, value: string): Promise<void> {
    await setGmValue(key, value, { sensitive: true })
  },
  async remove(key: string): Promise<void> {
    await deleteGmValue(key, { sensitive: true })
  },
}

export const userscriptHistoryStorage: EnumerableTextStorage = {
  ...safeStorage,
  getItemsByPrefix(prefix: string): ReadonlyArray<readonly [string, string]> {
    const storage = globalThis.localStorage
    if (!storage) {
      throw new Error('localStorage 不可用')
    }
    const keys = new Set<string>()
    const length = storage.length
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(prefix)) {
        keys.add(key)
      }
    }
    const entries: Array<readonly [string, string]> = []
    // 枚举期间其他标签页可能增删记录；按 key 去重，并跳过读取前已删除的值。
    for (const key of keys) {
      const value = storage.getItem(key)
      if (value !== null) {
        entries.push([key, value])
      }
    }
    return entries
  },
}
