/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { afterEach, describe, expect, it, vi } from 'vitest'

import { MODEL_WORKER_DEPENDENCY_TIMEOUT_MS, withModelWorkerDependencyTimeout } from '../src/request-timeout'

describe('withModelWorkerDependencyTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns dependency results and clears the deadline timer', async () => {
    vi.useFakeTimers()

    await expect(withModelWorkerDependencyTimeout(Promise.resolve('ready'), 'KV')).resolves.toBe('ready')

    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a dependency that does not settle before the deadline', async () => {
    vi.useFakeTimers()
    const pending = expect(withModelWorkerDependencyTimeout(new Promise<never>(() => undefined), 'R2')).rejects.toThrow(
      'R2 dependency timed out',
    )

    await vi.advanceTimersByTimeAsync(MODEL_WORKER_DEPENDENCY_TIMEOUT_MS)

    await pending
    expect(vi.getTimerCount()).toBe(0)
  })
})
