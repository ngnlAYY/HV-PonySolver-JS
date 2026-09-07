// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { loadVerifiedRuntimeWasm } from '../../src/inference/runtime-wasm-loader'
import { loadVerifiedRuntimeAsset } from '../../src/inference/verified-runtime-asset-loader'

const expectedAsset = {
  url: 'https://models.ngnl.host/runtime/test.wasm',
  byteLength: 3,
  sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
  maxByteLength: 4,
} as const

describe('loadVerifiedRuntimeWasm', () => {
  it('accepts only the exact first-party bytes', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-length': '3' },
        }),
    ) as unknown as typeof fetch

    const result = await loadVerifiedRuntimeWasm(fetchImpl, expectedAsset)

    expect([...new Uint8Array(result)]).toEqual([1, 2, 3])
    expect(fetchImpl).toHaveBeenCalledWith('https://models.ngnl.host/runtime/test.wasm', {
      cache: 'force-cache',
      redirect: 'error',
    })
  })

  it('rejects a response larger than the configured cap before hashing', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4, 5]), {
          status: 200,
          headers: { 'content-length': '5' },
        }),
    ) as unknown as typeof fetch
    await expect(loadVerifiedRuntimeWasm(fetchImpl, expectedAsset)).rejects.toThrow('响应大小无效')
  })

  it('rejects same-sized bytes with a different SHA-256', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(new Uint8Array([3, 2, 1]), { status: 200 }),
    ) as unknown as typeof fetch
    await expect(loadVerifiedRuntimeWasm(fetchImpl, expectedAsset)).rejects.toThrow('SHA-256 校验失败')
  })

  it('rejects a bodyless response without using the unbounded arrayBuffer fallback', async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': '3' }),
      body: null,
      arrayBuffer,
    } as unknown as Response
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch

    await expect(loadVerifiedRuntimeWasm(fetchImpl, expectedAsset)).rejects.toThrow('ONNX Runtime WASM 响应正文不可用')
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('preserves the size-limit error when stream cancellation also fails', async () => {
    const reader = {
      read: vi.fn(async () => ({ done: false as const, value: new Uint8Array([1, 2, 3, 4, 5]) })),
      cancel: vi.fn(async () => {
        throw new Error('cancel failed')
      }),
      releaseLock: vi.fn(),
    }
    const response = {
      ok: true,
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch

    await expect(loadVerifiedRuntimeWasm(fetchImpl, expectedAsset)).rejects.toThrow('ONNX Runtime WASM 超过大小上限')
    expect(reader.cancel).toHaveBeenCalledTimes(1)
    expect(reader.releaseLock).toHaveBeenCalledTimes(1)
  })

  it('aborts a hanging response stream after the response headers arrive', async () => {
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
      cancel: vi.fn(async () => undefined),
      releaseLock: vi.fn(),
    }
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': '3' }),
      body: { getReader: () => reader },
    } as unknown as Response
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch
    const controller = new AbortController()

    const loading = loadVerifiedRuntimeAsset('ONNX Runtime WASM', expectedAsset, fetchImpl, controller.signal)
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1))
    controller.abort(new Error('runtime download cancelled'))

    const abortDeadline = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('runtime load did not abort')), 50)
    })
    await expect(Promise.race([loading, abortDeadline])).rejects.toThrow('runtime download cancelled')
    expect(reader.cancel).toHaveBeenCalledTimes(1)
    expect(reader.releaseLock).toHaveBeenCalledTimes(1)
  })

  it('cancels a late response body when fetch ignores an earlier abort', async () => {
    let resolveResponse!: (response: Response) => void
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve
        }),
    ) as unknown as typeof fetch
    const controller = new AbortController()
    const loading = loadVerifiedRuntimeAsset('ONNX Runtime WASM', expectedAsset, fetchImpl, controller.signal)
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))

    controller.abort(new Error('runtime download cancelled'))
    await expect(loading).rejects.toThrow('runtime download cancelled')

    const cancel = vi.fn(async () => undefined)
    resolveResponse({ body: { cancel } } as unknown as Response)
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
  })
})
