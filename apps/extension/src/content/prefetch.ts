import type { DetectorService } from '@hv-pony-solver/browser-core/inference/inference-types'
import type { HistoryStore } from '@hv-pony-solver/browser-core/persistence/answer-history-store'

/**
 * Warm experienced installs silently; fresh installs must not spend a download
 * before their first captcha. Repeated warm-ups without a detect exhaust a
 * same-tab budget so idle navigation stops reviving Offscreen. Real inference
 * or a new session restores that budget; visible preparation keeps its own timing.
 */
export const PREFETCH_MISS_STORAGE_KEY = 'hvPonySolverPrefetchMisses' as const
export const PREFETCH_MISS_LIMIT = 3

type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function safeSessionStorage(): SessionStorageLike | null {
  try {
    return globalThis.sessionStorage
  } catch {
    // Some privacy modes throw on mere access; skip backoff and keep warming.
    return null
  }
}

function readPrefetchMisses(store: SessionStorageLike): number {
  try {
    const raw = store.getItem(PREFETCH_MISS_STORAGE_KEY)
    const parsed = raw === null ? 0 : Number(raw)
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
  } catch {
    return 0
  }
}

function writePrefetchMisses(store: SessionStorageLike, misses: number): void {
  try {
    store.setItem(PREFETCH_MISS_STORAGE_KEY, String(misses))
  } catch {
    // Best-effort bookkeeping only; losing it just means one more prefetch.
  }
}

export function hasPrefetchBudget(): boolean {
  const store = safeSessionStorage()
  if (!store) {
    return true
  }
  return readPrefetchMisses(store) < PREFETCH_MISS_LIMIT
}

export function recordPrefetchMiss(): void {
  const store = safeSessionStorage()
  if (!store) {
    return
  }
  writePrefetchMisses(store, readPrefetchMisses(store) + 1)
}

export function resetPrefetchMisses(): void {
  const store = safeSessionStorage()
  if (!store) {
    return
  }
  try {
    store.removeItem(PREFETCH_MISS_STORAGE_KEY)
  } catch {
    // Nothing to recover: the next detect resets again.
  }
}

export function scheduleExperiencedPrefetch(
  history: HistoryStore,
  detector: DetectorService,
  getAbortSignal: () => AbortSignal | undefined,
): void {
  if (!history.hasHistory() || !hasPrefetchBudget()) {
    return
  }
  recordPrefetchMiss()
  void Promise.resolve()
    .then(async () => {
      await detector.prepare(getAbortSignal(), { silent: true })
    })
    .catch(() => undefined)
}
