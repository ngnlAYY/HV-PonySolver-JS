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
      arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('body aborted')), { once: true })
      }),
    } as Response))
    vi.stubGlobal('fetch', fetchMock)

    const downloadPromise = downloadModel(controller.signal)
    await Promise.resolve()
    controller.abort()

    await expect(downloadPromise).rejects.toThrow('body aborted')
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
