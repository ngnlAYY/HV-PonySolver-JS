import { inferenceTimeoutConfig } from '@hv-pony-solver/browser-core/inference/inference-config'

/**
 * Detect deadlines for the three hops a captcha image travels, derived from the
 * single worker-side budget in browser-core:
 *
 *   content client -> broker -> offscreen/Firefox Host (worker)
 *
 * Each margin is comment-only documentation: the worker aborts itself first,
 * the broker aborts the Host invocation a step later, and the content client
 * abandons slightly before that so the status panel recovers promptly. This
 * mirrors how prepareDeadlineConfig stages the much longer prepare budget.
 */
export const DETECT_DEADLINE_CONFIG = {
  /** Worker-side detect budget; the authoritative source of truth. */
  workerTimeoutMs: inferenceTimeoutConfig.workerDetectTimeoutMs,
  /** Worker budget + margin for offscreen claim and message relay overhead. */
  brokerTimeoutMs: inferenceTimeoutConfig.workerDetectTimeoutMs + 10_000,
  /**
   * Broker budget minus its own abort margin: the client abandons slightly
   * early so the user-facing panel recovers without waiting for the broker's
   * Host teardown, then cancels remotely through its still-open Port.
   */
  clientTimeoutMs: inferenceTimeoutConfig.workerDetectTimeoutMs + 5_000,
} as const
