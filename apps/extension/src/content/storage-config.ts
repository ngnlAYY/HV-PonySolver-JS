import { HISTORY_ENTRY_PREFIX, HISTORY_KEY } from '@hv-pony-solver/browser-core/persistence/answer-history-config'

export const STORAGE_INITIALIZATION_TIMEOUT_MS = 5_000
export const MAX_BUFFERED_STORAGE_KEYS = 1_024
export const MAX_STORAGE_PREFIX_INDICES = 4

export function isContentStorageKey(key: string): boolean {
  // 两个世界的历史都用于判断是否允许预热，不能只保留当前世界。
  return key.startsWith('hvPonySolver') || key === HISTORY_KEY || key.startsWith(HISTORY_ENTRY_PREFIX)
}
