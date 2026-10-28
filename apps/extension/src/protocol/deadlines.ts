import { inferenceTimeoutConfig } from '@hv-pony-solver/browser-core/inference/inference-config'

export const OFFSCREEN_CONTROL_TIMEOUT_MS = 5_000

// Host 的 Worker 请求先超时；内容端提前于 Broker 放弃并发送取消，给远端退场留出余量。
export const DETECT_DEADLINE_CONFIG = {
  workerTimeoutMs: inferenceTimeoutConfig.workerDetectTimeoutMs,
  brokerTimeoutMs: inferenceTimeoutConfig.workerDetectTimeoutMs + 10_000,
  clientTimeoutMs: inferenceTimeoutConfig.workerDetectTimeoutMs + 5_000,
} as const
