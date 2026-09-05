import { afterEach, describe, expect, it, vi } from 'vitest'

import { readBoundedByteStream, sha256Hex } from '../../src/platform/byte-stream'
import { raceAbort } from '../../src/utils/abort-race'

afterEach(() => vi.unstubAllGlobals())

const sizeError = (actual: number, limit: number): Error => new Error(`size ${actual}/${limit}`)

function stream(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk))
      controller.close()
    },
  })
}

describe('bounded byte streams', () => {
  it('allocates only the final known-size buffer for a multi-chunk asset', async () => {
    const body = stream([1], [2], [3])
    const allocations: number[] = []
    const OriginalUint8Array = Uint8Array
    vi.stubGlobal(
      'Uint8Array',
      new Proxy(OriginalUint8Array, {
        construct(target, args) {
          if (typeof args[0] === 'number') allocations.push(args[0])
          return Reflect.construct(target, args)
        },
      }),
    )
    const result = await readBoundedByteStream(body, { expectedByteLength: 3, maxByteLength: 4, sizeError })
    expect(allocations).toEqual([3])
    expect(Array.from(new OriginalUint8Array(result))).toEqual([1, 2, 3])
    expect(body.locked).toBe(false)
  })

  it('retains a bounded fallback for unknown lengths', async () => {
    const result = await readBoundedByteStream(stream([1], [2, 3]), {
      expectedByteLength: null,
      maxByteLength: 3,
      sizeError,
    })
    expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3])
  })

  it.each([
    { expectedByteLength: 3, maxByteLength: 4, chunks: [[1, 2]], error: 'size 2/3' },
    { expectedByteLength: 3, maxByteLength: 4, chunks: [[1, 2, 3, 4]], error: 'size 4/3' },
    { expectedByteLength: null, maxByteLength: 2, chunks: [[1], [2, 3]], error: 'size 3/2' },
  ])('rejects short or oversized bodies: $error', async ({ expectedByteLength, maxByteLength, chunks, error }) => {
    const body = stream(...chunks)
    await expect(readBoundedByteStream(body, { expectedByteLength, maxByteLength, sizeError })).rejects.toThrow(error)
    expect(body.locked).toBe(false)
  })

  it('cancels and releases a stalled reader without waiting for cancellation to settle', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const body = new ReadableStream<Uint8Array>({ cancel })
    const controller = new AbortController()
    const result = readBoundedByteStream(body, {
      expectedByteLength: 3,
      maxByteLength: 3,
      sizeError,
      wait: (promise) => raceAbort(promise, controller.signal),
    })
    controller.abort(new Error('stopped'))
    await expect(result).rejects.toThrow('stopped')
    expect(cancel).toHaveBeenCalledOnce()
    expect(body.locked).toBe(false)
  })

  it('rejects invalid allocation contracts before reading', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    await expect(readBoundedByteStream(body, { expectedByteLength: 4, maxByteLength: 3, sizeError })).rejects.toThrow(
      '资产长度契约无效',
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('hashes the actual bytes', async () => {
    expect(await sha256Hex(new Uint8Array([1, 2, 3]).buffer)).toBe(
      '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
    )
  })
})
