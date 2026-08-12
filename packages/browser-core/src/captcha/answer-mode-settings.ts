import type { AsyncStringStorage } from '../platform/storage'

export type AnswerMode = 'auto' | 'manual'

export const ANSWER_MODE_STORAGE_KEY = 'hvPonySolverAnswerMode'
export const DEFAULT_ANSWER_MODE: AnswerMode = 'auto'

export function isAnswerMode(value: unknown): value is AnswerMode {
  return value === 'auto' || value === 'manual'
}

export async function getAnswerMode(storage: AsyncStringStorage): Promise<AnswerMode> {
  try {
    const saved = await storage.get(ANSWER_MODE_STORAGE_KEY)
    return isAnswerMode(saved) ? saved : DEFAULT_ANSWER_MODE
  } catch {
    return DEFAULT_ANSWER_MODE
  }
}

export async function setAnswerMode(storage: AsyncStringStorage, mode: AnswerMode): Promise<void> {
  await storage.set(ANSWER_MODE_STORAGE_KEY, mode)
}
