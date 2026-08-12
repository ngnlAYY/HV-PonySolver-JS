import type { SettingsStorage } from '../platform/storage'

export const RANDOM_ON_FAIL_STORAGE_KEY = 'hvPonySolverRandomOnFail'
export const DEFAULT_RANDOM_ON_FAIL = true

export function getRandomOnFailSync(storage: SettingsStorage): boolean {
  try {
    const saved = storage.getSync(RANDOM_ON_FAIL_STORAGE_KEY)
    return saved === '1' ? true : saved === '0' ? false : DEFAULT_RANDOM_ON_FAIL
  } catch {
    return DEFAULT_RANDOM_ON_FAIL
  }
}

export async function getRandomOnFail(storage: SettingsStorage): Promise<boolean> {
  try {
    const saved = await storage.get(RANDOM_ON_FAIL_STORAGE_KEY)
    return saved === '1' ? true : saved === '0' ? false : DEFAULT_RANDOM_ON_FAIL
  } catch {
    return DEFAULT_RANDOM_ON_FAIL
  }
}

export async function setRandomOnFail(storage: SettingsStorage, enabled: boolean): Promise<void> {
  await storage.set(RANDOM_ON_FAIL_STORAGE_KEY, enabled ? '1' : '0')
}
