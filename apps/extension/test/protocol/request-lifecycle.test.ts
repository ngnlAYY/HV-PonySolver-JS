import { afterEach, expect, it, vi } from 'vitest'
import { createRequestLifecycle } from '../../src/protocol/request-lifecycle'

afterEach(() => vi.useRealTimers())

it('settles once and clears timers and abort listeners after a response', () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const resolve = vi.fn()
  const reject = vi.fn()
  const cleanup = vi.fn()
  const onAbandon = vi.fn()
  const lifecycle = createRequestLifecycle(resolve, reject, {
    signal: controller.signal,
    timeoutMs: 100,
    timeoutError: () => new Error('timeout'),
    abortError: () => new Error('abort'),
    cleanup,
    onAbandon,
  })
  lifecycle.start()
  lifecycle.start()
  lifecycle.resolve('value')
  controller.abort()
  vi.advanceTimersByTime(100)
  lifecycle.reject(new Error('late'))
  expect(resolve).toHaveBeenCalledExactlyOnceWith('value')
  expect(reject).not.toHaveBeenCalled()
  expect(cleanup).toHaveBeenCalledOnce()
  expect(onAbandon).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['abort', 'timeout'] as const)('abandons once on %s and ignores a late response', (reason) => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const resolve = vi.fn()
  const reject = vi.fn()
  const cleanup = vi.fn()
  const onAbandon = vi.fn()
  const lifecycle = createRequestLifecycle(resolve, reject, {
    signal: controller.signal,
    timeoutMs: 100,
    timeoutError: () => new Error('timeout'),
    abortError: () => new Error('abort'),
    cleanup,
    onAbandon,
  })
  if (reason === 'abort') controller.abort()
  lifecycle.start()
  vi.advanceTimersByTime(100)
  lifecycle.resolve('late')
  expect(resolve).not.toHaveBeenCalled()
  expect(reject).toHaveBeenCalledExactlyOnceWith(new Error(reason))
  expect(cleanup).toHaveBeenCalledOnce()
  expect(onAbandon).toHaveBeenCalledOnce()
  expect(lifecycle.settled).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
