// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { loadVerifiedRuntimeWasm } from '../../src/inference/runtime-wasm-loader'

const expectedAsset = {
  url: 'https://models.ngnl.host/runtime/test.wasm',
  byteLength: 3,
  sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
  maxByteLength: 4,
} as const

describe('loadVerifiedRuntimeWasm', () => {
  it('accepts only the exact first-party bytes', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-length': '3' },
    })) as unknown as typeof fetch

    const result = await loadVerifiedRuntimeWasm(fetchImpl, expectedAsset)

    expect([...new Uint8Array(result)]).toEqual([1, 2, 3])
    expect(fetchImpl).toHaveBeenCalledWith('https://models.ngnl.host/runtime/test.wasm', {
      cache: 'force-cache',
      redirect: 'error',
    })
  })

  it('rejects a response larger than the configured cap before hashing', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), {
      status: 200,
      headers: { 'content-length': '5' },
    })) as unknown as typeof fetch
    await expect(loadVerifiedRuntimeWasm(fetchImpl, expectedAsset)).rejects.toThrow('响应大小无效')
  })

  it('rejects same-sized bytes with a different SHA-256', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([3, 2, 1]), { status: 200 })) as unknown as typeof fetch
    await expect(loadVerifiedRuntimeWasm(fetchImpl, expectedAsset)).rejects.toThrow('SHA-256 校验失败')
  })
})
