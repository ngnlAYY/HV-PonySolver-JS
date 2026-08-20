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
