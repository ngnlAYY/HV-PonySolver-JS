import { describe, expect, it, vi } from 'vitest'

import {
  MODEL_ACCESS_KEY_STORAGE_KEY,
  clearModelAccessKey,
  getModelAccessKey,
  setModelAccessKey,
} from '../../src/model/model-settings'
import type { AsyncStringStorage } from '../../src/platform/storage'

const VALID_TOKEN = 'a'.repeat(64)

function storage(): AsyncStringStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value)
    },
    remove: async (key) => {
      values.delete(key)
    },
  }
}

describe('model access key settings', () => {
  it('persists a trimmed and lowercased valid token', async () => {
    const store = storage()

    await setModelAccessKey(store, `  ${VALID_TOKEN.toUpperCase()}  `)

    expect(store.values.get(MODEL_ACCESS_KEY_STORAGE_KEY)).toBe(VALID_TOKEN)
    await expect(getModelAccessKey(store)).resolves.toBe(VALID_TOKEN)
  })

  it('rejects keys that are not 64 hexadecimal characters', async () => {
    const store = storage()

    for (const invalid of ['abc-123', '0x123', VALID_TOKEN.slice(1), `g${'a'.repeat(63)}`]) {
      await expect(setModelAccessKey(store, invalid)).rejects.toThrow('模型下载 Key 格式无效')
    }
    expect(store.values.size).toBe(0)
  })

  it('clears the stored key when the caller saves an empty value', async () => {
    const store = storage()
    const removeSpy = vi.spyOn(store, 'remove')

    await setModelAccessKey(store, VALID_TOKEN)
    await setModelAccessKey(store, '   ')

    expect(store.values.has(MODEL_ACCESS_KEY_STORAGE_KEY)).toBe(false)
    expect(removeSpy).toHaveBeenCalledWith(MODEL_ACCESS_KEY_STORAGE_KEY)
    await clearModelAccessKey(store)
    expect(store.values.has(MODEL_ACCESS_KEY_STORAGE_KEY)).toBe(false)
  })
})
