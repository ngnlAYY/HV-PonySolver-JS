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

  it('invokes the ambient fetch implementation with the global receiver', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis)
      return Promise.resolve(response)
    })
    vi.stubGlobal('fetch', fetchMock)

    await downloadModel(undefined, { integrity: TEST_INTEGRITY })

    expect(fetchMock).toHaveBeenCalledTimes(1)
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

  it('continues without Authorization when saved key storage fails', async () => {
    getModelAccessKey.mockRejectedValue(new Error('storage unavailable'))
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    await downloadModel(undefined, { integrity: TEST_INTEGRITY })

    const [, init] = getFetchCall(fetchMock)
    expect(new Headers(init.headers).get('authorization')).toBeNull()
  })

  it('uses a candidate model access key without waiting for saved key storage', async () => {
    getModelAccessKey.mockReturnValue(new Promise<string>(() => {}))
    const response = new Response(new Uint8Array([1, 2, 3]))
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetchMock)

    const downloadPromise = downloadModel(undefined, {
      integrity: TEST_INTEGRITY,
      accessKeyOverride: ' candidate-key ',
    })

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

    await expect(downloadPromise).rejects.toThrow('模型下载已取消')
    expect(getFetchCall(fetchMock)[1].signal?.aborted).toBe(true)
  })

  it('forwards cancellation without requiring AbortSignal.any', async () => {
    const abortSignalConstructor = AbortSignal as typeof AbortSignal & { any?: typeof AbortSignal.any }
    const originalAny = abortSignalConstructor.any
    Object.defineProperty(abortSignalConstructor, 'any', { configurable: true, value: undefined })

    try {
      const controller = new AbortController()
      const fetchMock = vi.fn(
        async (_url: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(new Error('body aborted')), { once: true })
          }),
      )
      vi.stubGlobal('fetch', fetchMock)

      const downloadPromise = downloadModel(controller.signal)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      controller.abort()

      await expect(downloadPromise).rejects.toThrow('模型下载已取消')
      expect(getFetchCall(fetchMock)[1].signal?.aborted).toBe(true)
    } finally {
      Object.defineProperty(abortSignalConstructor, 'any', { configurable: true, value: originalAny })
    }
  })

  it('keeps forwarding caller aborts to the body after headers arrive without AbortSignal.any', async () => {
    const abortSignalConstructor = AbortSignal as typeof AbortSignal & { any?: typeof AbortSignal.any }
    const originalAny = abortSignalConstructor.any
    Object.defineProperty(abortSignalConstructor, 'any', { configurable: true, value: undefined })

    try {
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
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      // Caller cancellation must still reach fetch after response headers arrive.
      await Promise.resolve()
      controller.abort()

      await expect(downloadPromise).rejects.toThrow('模型下载已取消')
      expect(getFetchCall(fetchMock)[1].signal?.aborted).toBe(true)
    } finally {
      Object.defineProperty(abortSignalConstructor, 'any', { configurable: true, value: originalAny })
    }
  })

  it('releases caller abort listeners after completion without AbortSignal.any', async () => {
    const abortSignalConstructor = AbortSignal as typeof AbortSignal & { any?: typeof AbortSignal.any }
    const originalAny = abortSignalConstructor.any
    Object.defineProperty(abortSignalConstructor, 'any', { configurable: true, value: undefined })

    try {
      const controller = new AbortController()
      const addSpy = vi.spyOn(controller.signal, 'addEventListener')
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')
      const response = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response),
      )

      const buffer = await downloadModel(controller.signal, { integrity: TEST_INTEGRITY, verifyIntegrity: false })

      expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3])
      // The shared deadline releases its caller listener after the operation settles.
      expect(removeSpy.mock.calls.length).toBe(addSpy.mock.calls.length)
    } finally {
      Object.defineProperty(abortSignalConstructor, 'any', { configurable: true, value: originalAny })
    }
  })

  it('cancels a pending saved-key read before any network request', async () => {
    const { promise: accessKeyPromise, resolve: resolveAccessKey } = Promise.withResolvers<string>()
    getModelAccessKey.mockReturnValueOnce(accessKeyPromise)
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = downloadModel(controller.signal, { integrity: TEST_INTEGRITY })
    await vi.waitFor(() => expect(getModelAccessKey).toHaveBeenCalled())

    controller.abort()
    await expect(pending).rejects.toThrow('模型下载已取消')
    resolveAccessKey('late-key')
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels digest verification without accepting a late result', async () => {
    const { promise: digestPromise, resolve: resolveDigest } = Promise.withResolvers<ArrayBuffer>()
    const digest = vi.spyOn(crypto.subtle, 'digest').mockReturnValueOnce(digestPromise)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
    )
    const controller = new AbortController()
    const pending = downloadModel(controller.signal, { integrity: TEST_INTEGRITY })
    await vi.waitFor(() => expect(digest).toHaveBeenCalledTimes(1))

    controller.abort()
    await expect(pending).rejects.toThrow('模型下载已取消')
    resolveDigest(new ArrayBuffer(32))
    await Promise.resolve()
    await expect(pending).rejects.toThrow('模型下载已取消')
  })
})
