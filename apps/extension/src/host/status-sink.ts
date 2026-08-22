import type {
  CacheStatusSink,
  InferenceStatusSink,
  PanelStatus,
} from '@hv-pony-solver/browser-core/status-panel/status-panel-types'

import type { HostStatusUpdate } from '../protocol/messages'

export type HostStatusEmitter = (status: HostStatusUpdate) => void

export const silentStatusSink: CacheStatusSink & InferenceStatusSink = {
  setStatus: () => undefined,
  setSessionReady: () => undefined,
}

/**
 * Forwards Host-side stage status to a caller-provided emitter.
 *
 * The inference row stays client-owned — the content client reports it with
 * full round-trip timing — and session-ready transitions stay client-owned as
 * well, so only the model and session stages travel to the panel.
 */
export function createForwardingStatusSink(emit: HostStatusEmitter): CacheStatusSink & InferenceStatusSink {
  return {
    // Method parameters are bivariant, so accepting the full panel status
    // satisfies both the cache (model-only) and inference sink interfaces.
    setStatus(changes: Partial<PanelStatus>) {
      const status: { model?: string; session?: string } = {}
      if (typeof changes.model === 'string' && changes.model) {
        status.model = changes.model
      }
      if (typeof changes.session === 'string' && changes.session) {
        status.session = changes.session
      }
      if (status.model !== undefined || status.session !== undefined) {
        emit(status)
      }
    },
    setSessionReady() {
      // Client-owned; see the doc comment above.
    },
  }
}
