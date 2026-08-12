import type { SettingsStorage, TextStorage } from '@hv-pony-solver/browser-core'

import {
  addStorageChangeListener,
  storageGetAll,
  storageRemove,
  storageSet,
  type StorageChanges,
} from '../platform/webextension'

export class ExtensionStorageMirror implements SettingsStorage, TextStorage {
  private readonly values = new Map<string, string>()
  private removeChangeListener: (() => void) | null = null

  static async create(): Promise<ExtensionStorageMirror> {
    const mirror = new ExtensionStorageMirror()
    const stored = await storageGetAll()
    for (const [key, value] of Object.entries(stored)) {
      if (typeof value === 'string') {
        mirror.values.set(key, value)
      }
    }
    mirror.removeChangeListener = addStorageChangeListener((changes, areaName) => {
      if (areaName === 'local') {
        mirror.applyChanges(changes)
      }
    })
    return mirror
  }

  getSync(key: string): string | null {
    return this.values.get(key) ?? null
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.getSync(key))
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value)
    await storageSet({ [key]: value })
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key)
    await storageRemove(key)
  }

  getItem(key: string): string | null {
    return this.getSync(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
    void storageSet({ [key]: value }).catch(() => undefined)
  }

  removeItem(key: string): void {
    this.values.delete(key)
    void storageRemove(key).catch(() => undefined)
  }

  destroy(): void {
    this.removeChangeListener?.()
    this.removeChangeListener = null
  }

  private applyChanges(changes: StorageChanges): void {
    for (const [key, change] of Object.entries(changes)) {
      if (typeof change.newValue === 'string') {
        this.values.set(key, change.newValue)
      } else {
        this.values.delete(key)
      }
    }
  }
}
