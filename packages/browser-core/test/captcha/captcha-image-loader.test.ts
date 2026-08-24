import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CachedImageLoader } from '../../src/captcha/captcha-image-loader'
import { imagePreprocessConfig } from '../../src/inference/inference-config'

vi.mock('../../src/utils/logger', () => ({
  warn: vi.fn(),
  log: vi.fn(),
  logError: vi.fn(),
}))

import * as logger from '../../src/utils/logger'

const FAKE_URL = 'https://hentaiverse.org/captcha/image.jpg'
const FAKE_BYTES = new TextEncoder().encode('fake-image')

function makeOkResponse(
  bytes: Uint8Array = FAKE_BYTES,
  headers: HeadersInit = {
    'content-type': 'image/jpeg',
    'content-length': String(bytes.byteLength),
  },
): Response {
  return new Response(bytes, { status: 200, headers })
}

function makeFailResponse(status: number): Response {
  return new Response(null, { status })
}

function makeStreamResponse(
  body: ReadableStream<Uint8Array>,
  headers: HeadersInit = { 'content-type': 'image/png' },
): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    body,
  } as Response
}

describe('CachedImageLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a blob for a cache hit without falling back or warning', async () => {
    const fetchStub = vi.fn().mockResolvedValueOnce(makeOkResponse())
    globalThis.fetch = fetchStub

    const result = await new CachedImageLoader().get(FAKE_URL)

    expect(result.type).toBe('image/jpeg')
    expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual(Array.from(FAKE_BYTES))
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('falls back after an HTTP cache miss and logs a warning', async () => {
    const fetchStub = vi.fn().mockResolvedValueOnce(makeFailResponse(504)).mockResolvedValueOnce(makeOkResponse())
    globalThis.fetch = fetchStub

    const result = await new CachedImageLoader().get(FAKE_URL)

    expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual(Array.from(FAKE_BYTES))
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.warn).mock.calls[0][0]).toContain('仅缓存读取失败')
  })

  it('falls back after a cache fetch throws and logs a warning', async () => {
    const fetchStub = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(makeOkResponse())
    globalThis.fetch = fetchStub

    const result = await new CachedImageLoader().get(FAKE_URL)

    expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual(Array.from(FAKE_BYTES))
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('gives the network fallback its own budget after a slow cache read', async () => {
    vi.useFakeTimers()
    const hanging = new Promise<Response>(() => undefined)
    const fetchStub = vi.fn().mockResolvedValueOnce(hanging).mockResolvedValueOnce(makeOkResponse())
    globalThis.fetch = fetchStub

    const resultPromise = new CachedImageLoader(50).get(FAKE_URL)
    await vi.advanceTimersByTimeAsync(60)
    const result = await resultPromise

    expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual(Array.from(FAKE_BYTES))
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect((fetchStub.mock.calls[1]![1] as RequestInit).cache).toBe('default')
  })

  it('reports the fallback suffix when both requests fail', async () => {
    const fetchStub = vi.fn().mockResolvedValueOnce(makeFailResponse(504)).mockResolvedValueOnce(makeFailResponse(503))
    globalThis.fetch = fetchStub

    await expect(new CachedImageLoader().get(FAKE_URL)).rejects.toThrow('图片缓存不可用: HTTP 503 (回退也失败)')
  })

  it.each([
    'image/jpeg',
    'image/png; charset = binary',
    'image/gif ; foo=bar; quoted="value with spaces"',
    'IMAGE/WEBP;version=1',
  ])('accepts supported Content-Type %j with optional parameters', async (type) => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(makeOkResponse(FAKE_BYTES, {
      'content-type': type,
      'content-length': String(FAKE_BYTES.byteLength),
    }))

    const result = await new CachedImageLoader().get(FAKE_URL)

    expect(Array.from(new Uint8Array(await result.arrayBuffer()))).toEqual(Array.from(FAKE_BYTES))
  })

  it.each([
    null,
    '',
    'text/html',
    'image/svg+xml',
    'image/jpg',
    'image/png trailing',
    'image/png;',
    'image/png; charset',
    'image/png; charset="unterminated',
  ])('rejects unsupported or malformed Content-Type %j before reading the body', async (type) => {
    const body = { cancel: vi.fn(async () => undefined), getReader: vi.fn() }
    const headers = type === null ? {} : { 'content-type': type }
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeStreamResponse(body as unknown as ReadableStream<Uint8Array>, headers))
      .mockResolvedValueOnce(makeStreamResponse(body as unknown as ReadableStream<Uint8Array>, headers))

    await expect(new CachedImageLoader().get(FAKE_URL)).rejects.toThrow('验证码图片 Content-Type 无效')
    expect(body.cancel).toHaveBeenCalledTimes(2)
    expect(body.getReader).not.toHaveBeenCalled()
  })

  it.each(['', '01', '+1', '-1', '1e3', '9007199254740992'])(
    'rejects invalid Content-Length %j before reading the body',
    async (length) => {
      const body = { cancel: vi.fn(async () => undefined), getReader: vi.fn() }
      const response = () => makeStreamResponse(body as unknown as ReadableStream<Uint8Array>, {
        'content-type': 'image/png',
        'content-length': length,
      })
      globalThis.fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response())

      await expect(new CachedImageLoader().get(FAKE_URL)).rejects.toThrow('验证码图片 Content-Length 无效')
      expect(body.cancel).toHaveBeenCalledTimes(2)
      expect(body.getReader).not.toHaveBeenCalled()
    },
  )

  it('rejects a declared body over the encoded byte limit before acquiring a reader', async () => {
    const body = { cancel: vi.fn(async () => undefined), getReader: vi.fn() }
    const response = () => makeStreamResponse(body as unknown as ReadableStream<Uint8Array>, {
      'content-type': 'image/png',
      'content-length': String(imagePreprocessConfig.maxEncodedBytes + 1),
    })
    globalThis.fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response())

    await expect(new CachedImageLoader().get(FAKE_URL)).rejects.toThrow(
      `验证码图片数据超过限制: ${imagePreprocessConfig.maxEncodedBytes + 1}`,
    )
    expect(body.cancel).toHaveBeenCalledTimes(2)
    expect(body.getReader).not.toHaveBeenCalled()
  })

  it('enforces the encoded byte cap while streaming and cleans up the reader', async () => {
    const oversizedChunk = new Uint8Array(imagePreprocessConfig.maxEncodedBytes + 1)
    const events: string[] = []
    const reader = {
      read: vi.fn(async () => ({ done: false as const, value: oversizedChunk })),
      cancel: vi.fn(async () => {
        events.push('cancel')
        throw new Error('cancel failed')
      }),
      releaseLock: vi.fn(() => events.push('release')),
    }
    const body = { getReader: vi.fn(() => reader) }
    const response = () => makeStreamResponse(body as unknown as ReadableStream<Uint8Array>)
    globalThis.fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response())

    await expect(new CachedImageLoader().get(FAKE_URL)).rejects.toThrow(
      `验证码图片数据超过限制: ${imagePreprocessConfig.maxEncodedBytes + 1}`,
    )
    expect(events).toEqual(['cancel', 'release', 'cancel', 'release'])
  })

  it.each([
    { name: 'shorter', declared: FAKE_BYTES.byteLength + 1 },
    { name: 'longer', declared: FAKE_BYTES.byteLength - 1 },
  ])('rejects an actual body $name than Content-Length', async ({ declared }) => {
    const response = () => makeOkResponse(FAKE_BYTES, {
      'content-type': 'image/gif',
      'content-length': String(declared),
    })
    globalThis.fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response())

    await expect(new CachedImageLoader().get(FAKE_URL)).rejects.toThrow(
      '验证码图片 Content-Length 与正文不匹配',
    )
  })

  it('rejects an empty body even when its declared length is zero', async () => {
    const response = () => makeOkResponse(new Uint8Array(), {
      'content-type': 'image/webp',
      'content-length': '0',
    })
    globalThis.fetch = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response())

    await expect(new CachedImageLoader().get(FAKE_URL)).rejects.toThrow('验证码图片数据为空')
  })

  it('aborts a pending fetch without falling back', async () => {
    const fetchStub = vi.fn(() => new Promise<Response>(() => undefined))
    globalThis.fetch = fetchStub
    const controller = new AbortController()

    const loadPromise = new CachedImageLoader().get(FAKE_URL, controller.signal)
    const requestSignal = (fetchStub.mock.calls[0]?.[1] as RequestInit | undefined)?.signal
    controller.abort()

    await expect(loadPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(requestSignal?.aborted).toBe(true)
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('aborts a pending stream read without falling back and cleans up', async () => {
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
      cancel: vi.fn(() => new Promise<void>(() => undefined)),
      releaseLock: vi.fn(() => {
        throw new TypeError('read still pending')
      }),
    }
    const body = { getReader: vi.fn(() => reader) }
    globalThis.fetch = vi.fn(async () => makeStreamResponse(body as unknown as ReadableStream<Uint8Array>))
    const controller = new AbortController()

    const loadPromise = new CachedImageLoader().get(FAKE_URL, controller.signal)
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1))
    controller.abort()

    await expect(loadPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(reader.cancel).toHaveBeenCalledTimes(1)
    expect(reader.releaseLock).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('enforces the deadline across fetching and streaming within one attempt', async () => {
    vi.useFakeTimers()
    const fetchStub = vi.fn(() => new Promise<Response>(() => undefined))
    globalThis.fetch = fetchStub

    const loadPromise = new CachedImageLoader(100).get(FAKE_URL)
    const rejection = expect(loadPromise).rejects.toMatchObject({ name: 'TimeoutError' })
    const requestSignal = (fetchStub.mock.calls[0]?.[1] as RequestInit | undefined)?.signal
    await vi.advanceTimersByTimeAsync(100)
    expect(requestSignal?.aborted).toBe(true)

    // The timed-out cache attempt falls back to the network with its own
    // budget; only when that attempt also expires does the load fail.
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)

    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses only-if-cached first and default for fallback with same-origin credentials', async () => {
    const fetchStub = vi.fn().mockResolvedValueOnce(makeFailResponse(504)).mockResolvedValueOnce(makeOkResponse())
    globalThis.fetch = fetchStub

    await new CachedImageLoader().get(FAKE_URL)

    const [firstCall, secondCall] = fetchStub.mock.calls as [string, RequestInit][]
    expect(firstCall[1]).toMatchObject({
      cache: 'only-if-cached',
      mode: 'same-origin',
      credentials: 'include',
    })
    expect(secondCall[1]).toMatchObject({
      cache: 'default',
      mode: 'same-origin',
      credentials: 'include',
    })
  })
})
