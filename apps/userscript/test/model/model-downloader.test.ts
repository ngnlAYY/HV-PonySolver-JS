import { beforeEach, describe, expect, it, vi } from 'vitest'

import { downloadModel } from '../../src/model/model-downloader'

const TEST_INTEGRITY = {
  byteLength: 3,
  sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
} as const

describe('downloadModel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('passes abort signal to fetch', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await downloadModel(controller.signal, TEST_INTEGRITY)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://models.ngnl.host/yolo26n-640.onnx?key=',
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('does not fetch when the caller signal is already aborted', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()

    await expect(downloadModel(controller.signal)).rejects.toThrow('模型下载已取消')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts while reading the response body', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => ({
      ok: true,
      headers: new Headers(),
      arrayBuffer: async () => {
        throw new Error('arrayBuffer should not be used')
      },
      body: new ReadableStream<Uint8Array>({
        start(streamController) {
          options.signal?.addEventListener('abort', () => streamController.error(new Error('body aborted')), { once: true })
        },
      }),
    } as Response))
    vi.stubGlobal('fetch', fetchMock)

    const downloadPromise = downloadModel(controller.signal)
    await Promise.resolve()
    controller.abort()

    await expect(downloadPromise).rejects.toThrow('body aborted')
  })

  it('rejects and cancels responses whose content length is larger than expected', async () => {
    const arrayBuffer = vi.fn()
    const cancel = vi.fn()
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': '4' }),
      arrayBuffer,
      body: { cancel },
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(async () => response))

    await expect(downloadModel(undefined, TEST_INTEGRITY)).rejects.toThrow('下载模型大小校验失败')

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('stops reading when the streamed model exceeds the expected size', async () => {
    let pulls = 0
    const arrayBuffer = vi.fn(async () => {
      throw new Error('arrayBuffer should not be used')
    })
    const response = {
      ok: true,
      headers: new Headers(),
      arrayBuffer,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1
          controller.enqueue(new Uint8Array([pulls]))
          if (pulls === 4) {
            controller.close()
          }
        },
      }),
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(async () => response))

    await expect(downloadModel(undefined, TEST_INTEGRITY)).rejects.toThrow('下载模型大小校验失败')

    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(pulls).toBe(4)
  })

  it('rejects downloaded models with unexpected integrity', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]))
    vi.stubGlobal('fetch', vi.fn(async () => response))

    await expect(downloadModel(undefined, {
      byteLength: 4,
      sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
    })).rejects.toThrow('下载模型大小校验失败')
  })
})
