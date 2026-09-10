import type { SettingsStorage } from '../platform/storage'

export const RANDOM_ON_FAIL_STORAGE_KEY = 'hvPonySolverRandomOnFail'
export const DEFAULT_RANDOM_ON_FAIL = true

export function parseRandomOnFail(value: unknown): boolean {
  if (value === '1') {
    return true
  }
  if (value === '0') {
    return false
  }
  return DEFAULT_RANDOM_ON_FAIL
}

export function getRandomOnFailSync(storage: SettingsStorage): boolean {
  try {
    return parseRandomOnFail(storage.getSync(RANDOM_ON_FAIL_STORAGE_KEY))
  } catch {
    return DEFAULT_RANDOM_ON_FAIL
  }
}
