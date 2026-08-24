import type {
  CacheStatusSink,
  InferenceStatusSink,
  PanelStatus,
} from '@hv-pony-solver/browser-core/status-panel/status-panel-types'

import { pickForwardedHostFields, sessionReadyStatus } from './status-fields'
import type { HostStatusUpdate } from '../protocol/messages'

export type HostStatusEmitter = (status: HostStatusUpdate) => void

export const silentStatusSink: CacheStatusSink & InferenceStatusSink = {
  setStatus: () => undefined,
  setSessionReady: () => undefined,
}

/**
 * Forwards Host-side stage status to a caller-provided emitter.
 *
 * The inference row stays client-owned because only content can measure the
 * full round trip. Model and session stages, including the terminal ready
 * transition, travel across the Host boundary for snapshot replay.
 */
export function createForwardingStatusSink(emit: HostStatusEmitter): CacheStatusSink & InferenceStatusSink {
  return {
    // Method parameters are bivariant, so accepting the full panel status
    // satisfies both the cache (model-only) and inference sink interfaces.
    setStatus(changes: Partial<PanelStatus>) {
      const status = pickForwardedHostFields(changes)
      if (status.model !== undefined || status.session !== undefined) {
        emit(status)
      }
    },
    setSessionReady(elapsed) {
      emit(sessionReadyStatus(elapsed))
    },
  }
}
