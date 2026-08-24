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
 */
export function scheduleExperiencedPrefetch(
  history: HistoryStore,
  detector: DetectorService,
  getAbortSignal: () => AbortSignal | undefined,
): void {
  if (!history.hasHistory()) {
    return
  }
  void Promise.resolve()
    .then(async () => {
      await detector.prepare(getAbortSignal(), { silent: true })
    })
    .catch(() => undefined)
}
