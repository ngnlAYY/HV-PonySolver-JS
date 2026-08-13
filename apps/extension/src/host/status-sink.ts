import type {
  CacheStatusSink,
  InferenceStatusSink,
} from '@hv-pony-solver/browser-core/status-panel/status-panel-types'

export const silentStatusSink: CacheStatusSink & InferenceStatusSink = {
  setStatus: () => undefined,
  setSessionReady: () => undefined,
}
