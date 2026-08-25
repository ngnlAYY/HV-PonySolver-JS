import type { AsyncStringStorage, SettingsStorage } from '../platform/storage'

export const PRESERVE_CHECKED_ANSWERS_STORAGE_KEY = 'hvPonySolverPreserveCheckedAnswers'
export const DEFAULT_PRESERVE_CHECKED_ANSWERS = true

export function parsePreserveCheckedAnswers(value: unknown): boolean {
  return value === '0' ? false : value === '1' ? true : DEFAULT_PRESERVE_CHECKED_ANSWERS
}

export function getPreserveCheckedAnswersSync(storage: SettingsStorage): boolean {
  try {
    return parsePreserveCheckedAnswers(storage.getSync(PRESERVE_CHECKED_ANSWERS_STORAGE_KEY))
  } catch {
    return DEFAULT_PRESERVE_CHECKED_ANSWERS
  }
}

export async function getPreserveCheckedAnswers(storage: AsyncStringStorage): Promise<boolean> {
  try {
    return parsePreserveCheckedAnswers(await storage.get(PRESERVE_CHECKED_ANSWERS_STORAGE_KEY))
  } catch {
    return DEFAULT_PRESERVE_CHECKED_ANSWERS
  }
}

export async function setPreserveCheckedAnswers(storage: AsyncStringStorage, value: boolean): Promise<void> {
  await storage.set(PRESERVE_CHECKED_ANSWERS_STORAGE_KEY, value ? '1' : '0')
}
