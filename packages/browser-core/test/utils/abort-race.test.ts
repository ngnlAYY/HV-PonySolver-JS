import { describe, expect, it, vi } from 'vitest'

import { raceAbort } from '../../src/utils/abort-race'

function deferred<T>(): Readonly<{
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}> {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (error: unknown) => void
  return {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    }),
    resolve: resolvePromise,
    reject: rejectPromise,
  }
}

describe('raceAbort', () => {
  it('resolves with the underlying value when no signal is given', async () => {
    await expect(raceAbort(Promise.resolve('value'), undefined)).resolves.toBe('value')
  })

  it('rejects immediately with a pre-aborted signal and detaches the operation', async () => {
    const controller = new AbortController()
    controller.abort()
    const operation = deferred<void>()

    const raced = raceAbort(operation.promise, controller.signal, () => new Error('推理请求已取消'))

    operation.reject(new Error('late failure'))
    await expect(raced).rejects.toThrow('推理请求已取消')
  })

  it('rejects with the custom error when the signal aborts mid-flight', async () => {
    const controller = new AbortController()
    const onAbort = vi.fn()
    const operation = deferred<number>()
    const raced = raceAbort(operation.promise, controller.signal, () => new Error('已取消'), { onAbort })

    controller.abort()

    await expect(raced).rejects.toThrow('已取消')
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  it('falls back to the signal reason when no custom error builder is given', async () => {
    const controller = new AbortController()
    const reason = new Error('原生原因')
    const raced = raceAbort(deferred<void>().promise, controller.signal)

    controller.abort(reason)

    await expect(raced).rejects.toThrow('原生原因')
  })

  it('keeps the promise pending while holdOnAbort is true and settles later', async () => {
    const controller = new AbortController()
    const operation = deferred<string>()
    const raced = raceAbort(operation.promise, controller.signal, () => new Error('已取消'), {
      holdOnAbort: () => true,
    })

    controller.abort()
    await Promise.resolve()
    operation.resolve('still settled')

    await expect(raced).resolves.toBe('still settled')
  })

  it('propagates an underlying rejection when no abort happens', async () => {
    const controller = new AbortController()
    const raced = raceAbort(Promise.reject(new Error('底层失败')), controller.signal, () => new Error('已取消'))

    await expect(raced).rejects.toThrow('底层失败')
  })

  it('races multiple signals and rejects through whichever aborts first', async () => {
    const caller = new AbortController()
    const lifecycle = new AbortController()
    const operation = deferred<string>()
    const onAbort = vi.fn()
    const raced = raceAbort(operation.promise, [caller.signal, lifecycle.signal], () => new Error('生命周期取消'), {
      onAbort,
    })

    lifecycle.abort()
    await expect(raced).rejects.toThrow('生命周期取消')
    expect(onAbort).toHaveBeenCalledTimes(1)
  })
})
