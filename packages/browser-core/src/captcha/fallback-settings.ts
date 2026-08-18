import type { SettingsStorage } from '../platform/storage'

export const RANDOM_ON_FAIL_STORAGE_KEY = 'hvPonySolverRandomOnFail'
export const DEFAULT_RANDOM_ON_FAIL = true

export function parseRandomOnFail(value: unknown): boolean {
  return value === '1' ? true : value === '0' ? false : DEFAULT_RANDOM_ON_FAIL
}

export function getRandomOnFailSync(storage: SettingsStorage): boolean {
  try {
    return parseRandomOnFail(storage.getSync(RANDOM_ON_FAIL_STORAGE_KEY))
  } catch {
    return DEFAULT_RANDOM_ON_FAIL
  }
}

export async function getRandomOnFail(storage: SettingsStorage): Promise<boolean> {
  try {
    return parseRandomOnFail(await storage.get(RANDOM_ON_FAIL_STORAGE_KEY))
  } catch {
    return DEFAULT_RANDOM_ON_FAIL
  }
}

export async function setRandomOnFail(storage: SettingsStorage, enabled: boolean): Promise<void> {
  await storage.set(RANDOM_ON_FAIL_STORAGE_KEY, enabled ? '1' : '0')
}
