import { beforeEach, describe, expect, it, vi } from 'vitest'

const getModelAccessKey = vi.fn(async () => '')

vi.mock('../../src/model/model-settings', () => ({
  getModelAccessKey,
}))

const { downloadModel } = await import('../../src/model/model-downloader')

const TEST_INTEGRITY = {
  byteLength: 3,
  sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
} as const

describe('downloadModel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getModelAccessKey.mockResolvedValue('')
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

  it('uses the saved model access key when downloading', async () => {
    getModelAccessKey.mockResolvedValue('key with spaces & symbols')
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    await downloadModel(undefined, TEST_INTEGRITY)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://models.ngnl.host/yolo26n-640.onnx?key=key%20with%20spaces%20%26%20symbols',
      expect.objectContaining({ cache: 'no-store' }),
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
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    controller.abort()

    await expect(downloadPromise).rejects.toThrow('body aborted')
  })

  it('downloads models without integrity checks by default', async () => {
    const response = new Response(new Uint8Array([1, 2, 3, 4]))
    vi.stubGlobal('fetch', vi.fn(async () => response))

    const buffer = await downloadModel(undefined, {
      byteLength: 1,
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
    })

    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3, 4])
  })

  it('does not reject larger content length when integrity verification is disabled', async () => {
    const response = new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: { 'content-length': '4' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => response))

    const buffer = await downloadModel(undefined, TEST_INTEGRITY)

    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3, 4])
  })

  it('rejects and cancels responses whose content length is larger than expected when integrity verification is enabled', async () => {
    const arrayBuffer = vi.fn()
    const cancel = vi.fn()
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': '4' }),
      arrayBuffer,
      body: { cancel },
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(async () => response))

    await expect(downloadModel(undefined, TEST_INTEGRITY, true)).rejects.toThrow('下载模型大小校验失败')

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('reads oversized streamed models when integrity verification is disabled', async () => {
    let pulls = 0
    const response = {
      ok: true,
      headers: new Headers(),
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

    const buffer = await downloadModel(undefined, TEST_INTEGRITY)

    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3, 4])
  })

  it('stops reading when the streamed model exceeds the expected size and integrity verification is enabled', async () => {
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

    await expect(downloadModel(undefined, TEST_INTEGRITY, true)).rejects.toThrow('下载模型大小校验失败')

    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(pulls).toBe(4)
  })

  it('rejects downloaded models with unexpected integrity when integrity verification is enabled', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]))
    vi.stubGlobal('fetch', vi.fn(async () => response))

    await expect(downloadModel(undefined, {
      byteLength: 4,
      sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
    }, true)).rejects.toThrow('下载模型大小校验失败')
  })
})
