import type { AsyncStringStorage } from '../platform/storage'
import { normalizeModelAccessToken } from '@hv-pony-solver/shared/token'

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
  const token = normalizeModelAccessToken(normalized)
  if (!token) {
    throw new Error('模型下载 Key 格式无效：应为 64 位十六进制字符串')
  }
  await storage.set(MODEL_ACCESS_KEY_STORAGE_KEY, token)
}

export async function clearModelAccessKey(storage: AsyncStringStorage): Promise<void> {
  await storage.remove(MODEL_ACCESS_KEY_STORAGE_KEY)
}
