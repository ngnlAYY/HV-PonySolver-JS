import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelDownloadQuotaExceededError } from '../../src/model/model-download-error'

const getModelAccessKey = vi.fn(async () => '')

vi.mock('../../src/model/model-settings', () => ({
  getModelAccessKey,
}))

const { downloadModel } = await import('../../src/model/model-downloader')

const TEST_INTEGRITY = {
  byteLength: 3,
  sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
} as const
const MODEL_URL = 'https://models.ngnl.host/yolo26n-640.ort'

function getFetchCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return [url, init]
}

describe('downloadModel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    getModelAccessKey.mockResolvedValue('')
  })

  it('passes abort signal to fetch without token query or empty Authorization', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await downloadModel(controller.signal, { integrity: TEST_INTEGRITY })

    const [url, init] = getFetchCall(fetchMock)
    expect(url).toBe(MODEL_URL)
    expect(url).not.toContain('?key=')
    expect(new Headers(init.headers).get('authorization')).toBeNull()
    expect(init).toEqual(
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('uses the saved model access key as Authorization when downloading', async () => {
    getModelAccessKey.mockResolvedValue('saved-token')
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    await downloadModel(undefined, { integrity: TEST_INTEGRITY })

    const [url, init] = getFetchCall(fetchMock)
    expect(url).toBe(MODEL_URL)
    expect(url).not.toContain('saved-token')
    expect(url).not.toContain('?key=')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer saved-token')
    expect(init).toEqual(expect.objectContaining({ cache: 'no-store' }))
  })

  it('uses the candidate model access key override as trimmed Authorization', async () => {
    getModelAccessKey.mockResolvedValue('old-key')
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    await downloadModel(undefined, {
      accessKeyOverride: ' candidate-token ',
      integrity: TEST_INTEGRITY,
    })

    const [url, init] = getFetchCall(fetchMock)
    expect(url).toBe(MODEL_URL)
    expect(url).not.toContain('candidate-token')
    expect(url).not.toContain('?key=')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer candidate-token')
  })

  it('does not include access keys or tokenized URLs in HTTP errors', async () => {
    getModelAccessKey.mockResolvedValue('secret-token')
    const fetchMock = vi.fn(async () => new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY })).rejects.toThrow('模型下载失败: HTTP 403')
    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY })).rejects.not.toThrow('secret-token')
    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY })).rejects.not.toThrow('?key=')
  })

  it('returns a typed quota error with Retry-After metadata for HTTP 429', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 429, headers: { 'retry-after': '3600' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY })).rejects.toEqual(
      expect.objectContaining<ModelDownloadQuotaExceededError>({
        name: 'ModelDownloadQuotaExceededError',
        message: '本月 5 次模型下载额度已用完',
        retryAfterSeconds: 3600,
      }),
    )
  })

  it('omits Authorization for whitespace-only saved and override keys', async () => {
    getModelAccessKey.mockResolvedValue('   ')
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    await downloadModel(undefined, {
      accessKeyOverride: '  ',
      integrity: TEST_INTEGRITY,
    })

    const [url, init] = getFetchCall(fetchMock)
    expect(url).toBe(MODEL_URL)
    expect(url).not.toContain('?key=')
    expect(new Headers(init.headers).get('authorization')).toBeNull()
  })

  it('continues without Authorization when saved key storage fails', async () => {
    getModelAccessKey.mockRejectedValue(new Error('storage unavailable'))
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    await downloadModel(undefined, { integrity: TEST_INTEGRITY })

    const [, init] = getFetchCall(fetchMock)
    expect(new Headers(init.headers).get('authorization')).toBeNull()
  })

  it('uses a candidate model access key before saving settings', async () => {
    getModelAccessKey.mockResolvedValue('old-key')
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    await downloadModel(undefined, { integrity: TEST_INTEGRITY, accessKeyOverride: '  candidate key  ' })

    const [url, init] = getFetchCall(fetchMock)
    expect(url).toBe(MODEL_URL)
    expect(url).not.toContain('?key=')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer candidate key')
    expect(init).toEqual(expect.objectContaining({ cache: 'no-store' }))
  })

  it('uses a candidate model access key without waiting for saved key storage', async () => {
    getModelAccessKey.mockReturnValue(new Promise<string>(() => {}))
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    const downloadPromise = downloadModel(undefined, { integrity: TEST_INTEGRITY, accessKeyOverride: 'candidate-key' })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await expect(downloadPromise).resolves.toBeInstanceOf(ArrayBuffer)
    const [url, init] = getFetchCall(fetchMock)
    expect(url).toBe(MODEL_URL)
    expect(url).not.toContain('?key=')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer candidate-key')
    expect(init).toEqual(expect.objectContaining({ cache: 'no-store' }))
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
    const fetchMock = vi.fn(
      async (_url: string, options: RequestInit) =>
        ({
          ok: true,
          headers: new Headers(),
          arrayBuffer: async () => {
            throw new Error('arrayBuffer should not be used')
          },
          body: new ReadableStream<Uint8Array>({
            start(streamController) {
              options.signal?.addEventListener('abort', () => streamController.error(new Error('body aborted')), {
                once: true,
              })
            },
          }),
        }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)

    const downloadPromise = downloadModel(controller.signal)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    controller.abort()

    await expect(downloadPromise).rejects.toThrow('body aborted')
  })

  it('rejects and cancels responses whose content length is larger than expected by default', async () => {
    const arrayBuffer = vi.fn()
    const cancel = vi.fn()
    let readCount = 0
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': '4' }),
      arrayBuffer,
      body: {
        cancel,
        getReader: vi.fn(() => ({
          read: vi.fn(async () => {
            readCount += 1
            return readCount === 1
              ? { done: false, value: new Uint8Array([1, 2, 3, 4]) }
              : { done: true, value: undefined }
          }),
        })),
      },
    } as unknown as Response
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY })).rejects.toThrow('下载模型大小校验失败')

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('rejects invalid declared content lengths before reading the body', async () => {
    const arrayBuffer = vi.fn()
    const cancel = vi.fn()
    const getReader = vi.fn()
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': 'abc' }),
      arrayBuffer,
      body: { cancel, getReader },
    } as unknown as Response
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY, verifyIntegrity: false })).rejects.toThrow(
      '下载模型大小校验失败: abc',
    )

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(getReader).not.toHaveBeenCalled()
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it.each(['', '0x3', '1e3', '+3', '-0'])(
    'rejects non-decimal declared content length "%s" before reading the body',
    async (contentLength) => {
      const arrayBuffer = vi.fn()
      const cancel = vi.fn()
      const getReader = vi.fn()
      const response = {
        ok: true,
        headers: new Headers({ 'content-length': contentLength }),
        arrayBuffer,
        body: { cancel, getReader },
      } as unknown as Response
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response),
      )

      await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY, verifyIntegrity: false })).rejects.toThrow(
        '下载模型大小校验失败:',
      )

      expect(cancel).toHaveBeenCalledTimes(1)
      expect(getReader).not.toHaveBeenCalled()
      expect(arrayBuffer).not.toHaveBeenCalled()
    },
  )

  it('rejects unsafe decimal content lengths before reading the body', async () => {
    const cancel = vi.fn()
    const getReader = vi.fn()
    const contentLength = '9007199254740992'
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': contentLength }),
      body: { cancel, getReader },
    } as unknown as Response
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY, verifyIntegrity: false })).rejects.toThrow(
      `下载模型大小校验失败: ${contentLength}`,
    )

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(getReader).not.toHaveBeenCalled()
  })

  it('rejects downloaded models with unexpected integrity by default', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(
      downloadModel(undefined, {
        integrity: {
          byteLength: 4,
          sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
        },
      }),
    ).rejects.toThrow('下载模型大小校验失败')
  })

  it('can still skip integrity hash checks when explicitly disabled', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-length': '3' },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    const buffer = await downloadModel(undefined, { integrity: TEST_INTEGRITY, verifyIntegrity: false })

    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3])
  })

  it('rejects streamed short reads when content-length is declared and integrity verification is disabled', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1, 2]))
          controller.close()
        },
      }),
      {
        headers: { 'content-length': '3' },
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY, verifyIntegrity: false })).rejects.toThrow(
      '下载模型大小校验失败: 2 != 3',
    )
  })

  it('rejects streamed over-reads when content-length is smaller than the body', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.close()
        },
      }),
      {
        headers: { 'content-length': '2' },
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY, verifyIntegrity: false })).rejects.toThrow(
      '下载模型大小校验失败: 3 != 2',
    )
  })

  it('does not harden download without integrity configured, and reads streamed data', async () => {
    const response = {
      ok: true,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1]))
          controller.enqueue(new Uint8Array([2]))
          controller.enqueue(new Uint8Array([3]))
          controller.close()
        },
      }),
    } as unknown as Response
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    const buffer = await downloadModel(undefined, {
      forceVerifyIntegrity: false,
      integrity: TEST_INTEGRITY,
      verifyIntegrity: false,
    })

    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3])
  })

  it('rejects oversized streamed models even when integrity verification is disabled', async () => {
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY, verifyIntegrity: false })).rejects.toThrow(
      '下载模型大小校验失败',
    )

    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(pulls).toBe(4)
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY, forceVerifyIntegrity: true })).rejects.toThrow(
      '下载模型大小校验失败',
    )

    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(pulls).toBe(4)
  })

  it('rejects downloaded models with unexpected integrity when integrity verification is enabled', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(
      downloadModel(undefined, {
        integrity: {
          byteLength: 4,
          sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
        },
        forceVerifyIntegrity: true,
      }),
    ).rejects.toThrow('下载模型大小校验失败')
  })

  it('accepts fallback arrayBuffer responses at the max size when streams are unavailable', async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
    const response = {
      ok: true,
      headers: new Headers(),
      body: null,
      arrayBuffer,
    } as unknown as Response
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    const buffer = await downloadModel(undefined, { integrity: TEST_INTEGRITY, verifyIntegrity: false })

    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3])
    expect(arrayBuffer).toHaveBeenCalledTimes(1)
  })

  it('rejects fallback arrayBuffer short reads when content-length is declared', async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array([1, 2]).buffer)
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': '3' }),
      body: null,
      arrayBuffer,
    } as unknown as Response
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(downloadModel(undefined, { integrity: TEST_INTEGRITY, verifyIntegrity: false })).rejects.toThrow(
      '下载模型大小校验失败: 2 != 3',
    )
    expect(arrayBuffer).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized fallback arrayBuffer responses when streams are unavailable', async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer)
    const response = {
      ok: true,
      headers: new Headers(),
      body: null,
      arrayBuffer,
    } as unknown as Response
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(
      downloadModel(undefined, {
        integrity: TEST_INTEGRITY,
        verifyIntegrity: false,
      }),
    ).rejects.toThrow('下载模型大小校验失败: 4 > 3')
    expect(arrayBuffer).toHaveBeenCalledTimes(1)
  })

  it('rejects fallback arrayBuffer responses larger than the verified expected size', async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer)
    const response = {
      ok: true,
      headers: new Headers(),
      body: null,
      arrayBuffer,
    } as unknown as Response
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(
      downloadModel(undefined, {
        integrity: {
          ...TEST_INTEGRITY,
          byteLength: 3,
        },
        forceVerifyIntegrity: true,
      }),
    ).rejects.toThrow('下载模型大小校验失败: 4 != 3')
    expect(arrayBuffer).toHaveBeenCalledTimes(1)
  })

  it('rejects downloads exceeding integrity max size even when verifyIntegrity is false', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]))
          controller.close()
        },
      }),
      {
        headers: {
          'content-length': '4',
        },
      },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    )

    await expect(
      downloadModel(undefined, {
        integrity: TEST_INTEGRITY,
        verifyIntegrity: false,
      }),
    ).rejects.toThrow('下载模型大小校验失败: 4 > 3')
  })
})
