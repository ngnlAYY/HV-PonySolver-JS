import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CachedImageLoader } from '../../src/captcha/captcha-image-loader'

// mock logger，路径相对于本测试文件
vi.mock('../../src/utils/logger', () => ({
  warn: vi.fn(),
  log: vi.fn(),
  logError: vi.fn(),
}))

import * as logger from '../../src/utils/logger'

const FAKE_URL = 'https://hentaiverse.org/captcha/image.jpg'
const FAKE_BLOB = new Blob(['fake-image'], { type: 'image/jpeg' })

function makeOkResponse(blob: Blob): Response {
  return {
    ok: true,
    status: 200,
    blob: () => Promise.resolve(blob),
  } as unknown as Response
}

function makeFailResponse(status: number): Response {
  return {
    ok: false,
    status,
    blob: () => Promise.resolve(new Blob()),
  } as unknown as Response
}

describe('CachedImageLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('仅缓存命中时直接返回 blob，不触发第二次 fetch，也无 warn 日志', async () => {
    const fetchStub = vi.fn().mockResolvedValueOnce(makeOkResponse(FAKE_BLOB))
    globalThis.fetch = fetchStub

    const loader = new CachedImageLoader()
    const result = await loader.get(FAKE_URL)

    expect(result).toBe(FAKE_BLOB)
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('仅缓存失败（状态 504），回退普通 fetch 成功时返回 blob 并记录 warn', async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(makeFailResponse(504))
      .mockResolvedValueOnce(makeOkResponse(FAKE_BLOB))
    globalThis.fetch = fetchStub

    const loader = new CachedImageLoader()
    const result = await loader.get(FAKE_URL)

    expect(result).toBe(FAKE_BLOB)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logger.warn).mock.calls[0][0]).toContain('仅缓存读取失败')
  })

  it('仅缓存抛 TypeError，回退普通 fetch 成功时返回 blob 并记录 warn', async () => {
    const networkError = new TypeError('Failed to fetch')
    const fetchStub = vi
      .fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(makeOkResponse(FAKE_BLOB))
    globalThis.fetch = fetchStub

    const loader = new CachedImageLoader()
    const result = await loader.get(FAKE_URL)

    expect(result).toBe(FAKE_BLOB)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('两次 fetch 均失败时 reject，错误消息包含 "图片缓存不可用" 和 "回退也失败"', async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(makeFailResponse(504))
      .mockResolvedValueOnce(makeFailResponse(503))
    globalThis.fetch = fetchStub

    const loader = new CachedImageLoader()
    let caughtError: unknown
    try {
      await loader.get(FAKE_URL)
    } catch (e) {
      caughtError = e
    }
    expect(caughtError).toBeInstanceOf(Error)
    const message = (caughtError as Error).message
    expect(message).toContain('图片缓存不可用')
    expect(message).toContain('回退也失败')
  })

  it('第一次 fetch 使用 only-if-cached，第二次使用 default，两次均为 same-origin + credentials', async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(makeFailResponse(504))
      .mockResolvedValueOnce(makeOkResponse(FAKE_BLOB))
    globalThis.fetch = fetchStub

    const loader = new CachedImageLoader()
    await loader.get(FAKE_URL)

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
