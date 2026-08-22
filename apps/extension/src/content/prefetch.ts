import { HISTORY_KEY } from '@hv-pony-solver/browser-core/persistence/answer-history-config'
import type { DetectorService } from '@hv-pony-solver/browser-core/inference/inference-types'
import { isRecordObject } from '@hv-pony-solver/browser-core/utils/guards'

import type { ExtensionStorageMirror } from './storage-mirror'

function hasAnswerHistory(storage: ExtensionStorageMirror): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(storage.getItem(HISTORY_KEY) || '')
  } catch {
    return false
  }
  if (!isRecordObject(parsed)) {
    return false
  }
  for (const world of ['main', 'isekai'] as const) {
    const records = parsed[world]
    if (Array.isArray(records) && records.length > 0) {
      return true
    }
  }
  return false
}

/**
 * Warms the inference session right after page load instead of at the first
 * captcha, so the first captcha of a browsing session does not pay the
 * model-read and session-build cost.
 *
 * Gated on existing answer history: a fresh install stays lazy and never
 * spends a monthly download slot before its first captcha. Failures are
 * silent — the first real captcha retries with fully visible status.
 */
export function scheduleExperiencedPrefetch(
  storage: ExtensionStorageMirror,
  detector: DetectorService,
  getAbortSignal: () => AbortSignal | undefined,
): void {
  if (!hasAnswerHistory(storage)) {
    return
  }
  void Promise.resolve()
    .then(async () => {
      await detector.prepare(getAbortSignal())
    })
    .catch(() => undefined)
}
