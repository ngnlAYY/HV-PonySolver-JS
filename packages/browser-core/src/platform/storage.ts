/** Async key/value storage injected by each browser host. */
export interface AsyncStringStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** Synchronous snapshot used to render settings-dependent UI without a flash. */
export interface SyncStringStorage {
  getSync(key: string): string | null
  /** 已完成初始化且同步视图始终跟随已提交更改，无需再做异步首屏校正。 */
  readonly synchronousSnapshot?: boolean
}

export type SettingsStorage = AsyncStringStorage & SyncStringStorage

export interface TextStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}

export interface EnumerableTextStorage extends TextStorage {
  getItemsByPrefix(prefix: string): ReadonlyArray<readonly [key: string, value: string]>
}
