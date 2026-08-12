import type { AsyncStringStorage } from '../platform/storage'

export const MODEL_ACCESS_KEY_STORAGE_KEY = 'hvPonySolverModelAccessKey'

export async function getModelAccessKey(storage: AsyncStringStorage): Promise<string> {
  return (await storage.get(MODEL_ACCESS_KEY_STORAGE_KEY))?.trim() ?? ''
}

export async function setModelAccessKey(storage: AsyncStringStorage, value: string): Promise<void> {
  const normalized = value.trim()
  if (!normalized) {
    await storage.remove(MODEL_ACCESS_KEY_STORAGE_KEY)
    return
  }
  await storage.set(MODEL_ACCESS_KEY_STORAGE_KEY, normalized)
}

export async function clearModelAccessKey(storage: AsyncStringStorage): Promise<void> {
  await storage.remove(MODEL_ACCESS_KEY_STORAGE_KEY)
}
