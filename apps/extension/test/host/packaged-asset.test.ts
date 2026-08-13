// @vitest-environment node

import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { loadPackagedAsset } from '../../src/host/packaged-asset'

const exactBytes = Uint8Array.from([1, 2, 3])
const exactIntegrity = {
  byteLength: exactBytes.byteLength,
  sha256: createHash('sha256').update(exactBytes).digest('hex'),
} as const

function responseWithBody(
  body: ReadableStream<Uint8Array> | null,
  options: Readonly<{ status?: number; contentLength?: string }> = {},
): Response {
  return {
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    status: options.status ?? 200,
    headers: new Headers(options.contentLength === undefined ? {} : { 'content-length': options.contentLength }),
    body,
  } as Response
}

describe('loadPackagedAsset', () => {
  it('fetches the fixed extension URL and accepts only exact bytes', async () => {
    const fetchImpl = vi.fn(async () => new Response(exactBytes, {
      status: 200,
      headers: { 'content-length': String(exactBytes.byteLength) },
    })) as unknown as typeof fetch

    const result = await loadPackagedAsset(
      'chrome-extension://extension-id/model/yolo26n-640.ort',
      exactIntegrity,
      '扩展内置模型',
      fetchImpl,
    )

    expect([...new Uint8Array(result)]).toEqual([...exactBytes])
    expect(fetchImpl).toHaveBeenCalledWith('chrome-extension://extension-id/model/yolo26n-640.ort', {
      cache: 'force-cache',
      redirect: 'error',
    })
  })

  it('cancels a non-success response without replacing the HTTP error', async () => {
    const body = { cancel: vi.fn(async () => Promise.reject(new Error('cancel failed'))) }
    const fetchImpl = vi.fn(async () => responseWithBody(body as unknown as ReadableStream<Uint8Array>, { status: 404 })) as unknown as typeof fetch

    await expect(loadPackagedAsset('moz-extension://id/model/test.ort', exactIntegrity, '模型', fetchImpl))
      .rejects.toThrow('模型 读取失败: HTTP 404')
    expect(body.cancel).toHaveBeenCalledTimes(1)
  })

  it.each(['', 'abc', '01', '1e3', '+3', '-0', '9007199254740992'])(
    'rejects declared Content-Length %j before acquiring a reader',
    async (contentLength) => {
      const body = { cancel: vi.fn(async () => undefined), getReader: vi.fn() }
      const fetchImpl = vi.fn(async () => responseWithBody(
        body as unknown as ReadableStream<Uint8Array>,
        { contentLength },
      )) as unknown as typeof fetch

      await expect(loadPackagedAsset('moz-extension://id/model/test.ort', exactIntegrity, '模型', fetchImpl))
        .rejects.toThrow('模型 Content-Length 无效')
      expect(body.cancel).toHaveBeenCalledTimes(1)
      expect(body.getReader).not.toHaveBeenCalled()
    },
  )

  it('rejects a mismatched declared length before acquiring a reader', async () => {
    const body = { cancel: vi.fn(async () => undefined), getReader: vi.fn() }
    const fetchImpl = vi.fn(async () => responseWithBody(
      body as unknown as ReadableStream<Uint8Array>,
      { contentLength: '4' },
    )) as unknown as typeof fetch

    await expect(loadPackagedAsset('moz-extension://id/model/test.ort', exactIntegrity, '模型', fetchImpl))
      .rejects.toThrow('模型 大小校验失败')
    expect(body.cancel).toHaveBeenCalledTimes(1)
    expect(body.getReader).not.toHaveBeenCalled()
  })

  it('rejects a response without a readable body', async () => {
    const fetchImpl = vi.fn(async () => responseWithBody(null)) as unknown as typeof fetch

    await expect(loadPackagedAsset('moz-extension://id/model/test.ort', exactIntegrity, '模型', fetchImpl))
      .rejects.toThrow('模型 响应正文不可用')
  })

  it.each([
    { name: 'short', chunk: Uint8Array.from([1, 2]) },
    { name: 'long', chunk: Uint8Array.from([1, 2, 3, 4]) },
  ])('cancels a $name stream before releasing its reader lock', async ({ chunk }) => {
    const events: string[] = []
    let reads = 0
    const reader = {
      read: vi.fn(async () => {
        reads += 1
        return reads === 1 ? { done: false, value: chunk } : { done: true, value: undefined }
      }),
      cancel: vi.fn(async () => {
        events.push('cancel')
        throw new Error('cancel failed')
      }),
      releaseLock: vi.fn(() => events.push('release')),
    }
    const body = { getReader: vi.fn(() => reader) }
    const fetchImpl = vi.fn(async () => responseWithBody(body as unknown as ReadableStream<Uint8Array>)) as unknown as typeof fetch

    await expect(loadPackagedAsset('moz-extension://id/model/test.ort', exactIntegrity, '模型', fetchImpl))
      .rejects.toThrow('模型 大小校验失败')
    expect(events).toEqual(['cancel', 'release'])
  })

  it('preserves a stream read failure when cancellation also fails', async () => {
    const reader = {
      read: vi.fn(async () => Promise.reject(new Error('stream failed'))),
      cancel: vi.fn(async () => Promise.reject(new Error('cancel failed'))),
      releaseLock: vi.fn(),
    }
    const body = { getReader: vi.fn(() => reader) }
    const fetchImpl = vi.fn(async () => responseWithBody(body as unknown as ReadableStream<Uint8Array>)) as unknown as typeof fetch

    await expect(loadPackagedAsset('moz-extension://id/model/test.ort', exactIntegrity, '模型', fetchImpl))
      .rejects.toThrow('stream failed')
    expect(reader.cancel).toHaveBeenCalledTimes(1)
    expect(reader.releaseLock).toHaveBeenCalledTimes(1)
  })

  it('rejects same-sized bytes with a different SHA-256', async () => {
    const fetchImpl = vi.fn(async () => new Response(Uint8Array.from([3, 2, 1]), { status: 200 })) as unknown as typeof fetch

    await expect(loadPackagedAsset('moz-extension://id/model/test.ort', exactIntegrity, '模型', fetchImpl))
      .rejects.toThrow('模型 完整性校验失败')
  })
})
