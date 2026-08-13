import {
  callbackError,
  resolveRawExtensionApi,
  type StorageChanges,
} from './webextension-api'

export async function storageGetAll(): Promise<Record<string, unknown>> {
  const { api, promiseStyle } = resolveRawExtensionApi()
  if (promiseStyle) {
    return api.storage.local.get(null) as Promise<Record<string, unknown>>
  }
  return new Promise((resolve, reject) => {
    api.storage.local.get(null, (items) => {
      const error = callbackError(api.runtime)
      if (error) {
        reject(error)
        return
      }
      resolve(items)
    })
  })
}

export async function storageSet(items: Record<string, unknown>): Promise<void> {
  const { api, promiseStyle } = resolveRawExtensionApi()
  if (promiseStyle) {
    await api.storage.local.set(items)
    return
  }
  await new Promise<void>((resolve, reject) => {
    api.storage.local.set(items, () => {
      const error = callbackError(api.runtime)
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export async function storageRemove(keys: string | string[]): Promise<void> {
  const { api, promiseStyle } = resolveRawExtensionApi()
  if (promiseStyle) {
    await api.storage.local.remove(keys)
    return
  }
  await new Promise<void>((resolve, reject) => {
    api.storage.local.remove(keys, () => {
      const error = callbackError(api.runtime)
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export function addStorageChangeListener(
  listener: (changes: StorageChanges, areaName: string) => void,
): () => void {
  const event = resolveRawExtensionApi().api.storage.onChanged
  event.addListener(listener)
  return () => event.removeListener(listener)
}
