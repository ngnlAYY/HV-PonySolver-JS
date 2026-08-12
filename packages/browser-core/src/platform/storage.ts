export interface AsyncStringStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export interface SyncStringStorage {
  getSync(key: string): string | null
}

export type SettingsStorage = AsyncStringStorage & SyncStringStorage

export interface TextStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
