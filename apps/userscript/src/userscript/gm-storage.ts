import type { SettingsStorage } from '@hv-pony-solver/browser-core'

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
  get: gmSettingsStorage.get,
  getSync: gmSettingsStorage.getSync,
  async set(key: string, value: string): Promise<void> {
    await setGmValue(key, value, { sensitive: true })
  },
  remove: gmSettingsStorage.remove,
}

export const userscriptHistoryStorage = safeStorage
