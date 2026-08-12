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

export const userscriptHistoryStorage = safeStorage
