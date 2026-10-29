import { afterEach, describe, expect, it, vi } from 'vitest'

import { inferenceTimeoutConfig, prepareDeadlineConfig } from '../../src/inference/inference-config'
import { randDelay, shuffle, sleep } from '../../src/utils/delay'
import { formatErrorMessage } from '../../src/utils/errors'

describe('configuration contracts', () => {
  it('keeps preparation deadlines aligned and ordered', () => {
    expect(inferenceTimeoutConfig.workerPrepareTimeoutMs).toBe(prepareDeadlineConfig.workerTimeoutMs)
    expect(prepareDeadlineConfig.workerTimeoutMs).toBeLessThan(prepareDeadlineConfig.contentTimeoutMs)
    expect(prepareDeadlineConfig.contentTimeoutMs).toBeLessThan(prepareDeadlineConfig.brokerTimeoutMs)
  })
})

describe('browser-core utility functions', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats unknown errors the same way as the legacy script', () => {
    expect(formatErrorMessage('plain')).toBe('plain')
    expect(formatErrorMessage(undefined)).toBe('未知错误')
    expect(formatErrorMessage(new TypeError('bad'))).toBe('TypeError: bad')
    expect(formatErrorMessage({ name: 'CustomError' })).toBe('CustomError')
  })

  it('renders a carried userMessage verbatim instead of the class-name prefix', () => {
    expect(formatErrorMessage({ name: 'NoisyError', message: 'raw text', userMessage: '已经过翻译的文案' })).toBe(
      '已经过翻译的文案',
    )
    expect(formatErrorMessage({ name: 'NoisyError', message: 'raw text', userMessage: '' })).toBe(
      'NoisyError: raw text',
    )
  })

  it.each([
    Object.create(null),
    {
      get userMessage() {
        throw new Error('getter failed')
      },
    },
    {
      message: {
        toString() {
          throw new Error('coercion failed')
        },
      },
    },
  ])('keeps error reporting usable when the thrown value cannot be inspected', (error: unknown) => {
    expect(formatErrorMessage(error)).toBe('未知错误')
  })

  it('returns random delays inside the inclusive range', () => {
    for (let i = 0; i < 100; i += 1) {
      const value = randDelay([3, 5])
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThanOrEqual(5)
    }
  })

  it('shuffles without mutating or losing values', () => {
    const source = ['a', 'b', 'c', 'd']
    const result = shuffle(source)

    expect(source).toEqual(['a', 'b', 'c', 'd'])
    expect([...result].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('resolves an aborted sleep immediately without scheduling a timer', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()

    await sleep(1000, controller.signal)

    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its timer and abort listener when aborted during sleep', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener')
    const promise = sleep(1000, controller.signal)

    expect(vi.getTimerCount()).toBe(1)
    controller.abort()
    await promise

    expect(vi.getTimerCount()).toBe(0)
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
