import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readAnswerSettings } from '../../src/captcha/read-answer-settings'
import { inferenceTimeoutConfig } from '../../src/inference/inference-config'

describe('answer settings read lifetime', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not start a read or timer when already canceled', async () => {
    const controller = new AbortController()
    controller.abort()
    const read = vi.fn(async () => 'auto')
    await expect(readAnswerSettings(read, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['resolve', 'reject'] as const)(
    'releases cancellation immediately and consumes a late %s',
    async (outcome) => {
      const controller = new AbortController()
      const remove = vi.spyOn(controller.signal, 'removeEventListener')
      let finish: (() => void) | undefined
      const pending = readAnswerSettings(
        () =>
          new Promise((resolve, reject) => {
            finish = () => (outcome === 'resolve' ? resolve('auto') : reject(new Error('late settings failure')))
          }),
        controller.signal,
      )
      const canceled = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      controller.abort()
      await canceled
      expect(vi.getTimerCount()).toBe(0)
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
      finish?.()
      await Promise.resolve()
    },
  )

  it('times out a pending read and removes the caller listener', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = readAnswerSettings(() => new Promise(() => undefined), controller.signal)
    const timedOut = expect(pending).rejects.toThrow('读取答题设置超时')
    await vi.advanceTimersByTimeAsync(inferenceTimeoutConfig.settingsReadTimeoutMs)
    await timedOut
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    expect(controller.signal.aborted).toBe(false)
  })

  it('cleans up after a successful read or synchronous provider failure', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    await expect(readAnswerSettings(async () => 'manual', controller.signal)).resolves.toBe('manual')
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    await expect(
      readAnswerSettings(() => {
        throw new Error('unavailable')
      }),
    ).rejects.toThrow('unavailable')
    expect(vi.getTimerCount()).toBe(0)
  })
})
