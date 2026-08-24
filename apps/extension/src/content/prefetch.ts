import type { DetectorService } from '@hv-pony-solver/browser-core/inference/inference-types'
import type { HistoryStore } from '@hv-pony-solver/browser-core/persistence/answer-history-store'

/**
 * Warms the inference session right after page load instead of at the first
 * captcha, so the first captcha of a browsing session does not pay the
 * model-read and session-build cost.
 *
 * Gated on strictly validated answer history that contains at least one real
 * answer: a fresh install stays lazy and never spends a monthly download slot
 * before its first captcha. The warm-up is silent — the status panel only
 * reports the first real captcha's own prepare.
 *
 * Additionally gated by a sessionStorage miss counter so users who load pages
 * without ever solving keep their Offscreen document from being revived on
 * every navigation: after PREFETCH_MISS_LIMIT consecutive prefetches without a
 * detect on the same page, further page loads stay lazy until an actual detect
 * (which resets the counter) or a fresh session re-enables the warm-up.
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

/**
 * Whether this page load still has idle-prefetch budget left. Unavailable or
 * hostile sessionStorage keeps the legacy always-warm behavior.
 */
export function hasPrefetchBudget(): boolean {
  const store = safeSessionStorage()
  if (!store) {
    return true
  }
  return readPrefetchMisses(store) < PREFETCH_MISS_LIMIT
}

/**
 * Records that a page consumed one warm-up without a detect. Called only when
 * a prefetch actually fires.
 */
export function recordPrefetchMiss(): void {
  const store = safeSessionStorage()
  if (!store) {
    return
  }
  writePrefetchMisses(store, readPrefetchMisses(store) + 1)
}

/**
 * Clears the backoff budget once this page really issued a detect request,
 * so the next idle page loads warm up again.
 */
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
