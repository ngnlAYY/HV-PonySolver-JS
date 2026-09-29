import { imagePreprocessConfig } from '../inference/inference-config'
import { resolveFetchImplementation } from '../platform/fetch'
import { cancelByteStream, readBoundedByteStream } from '../platform/byte-stream'
import { raceAbort } from '../utils/abort-race'
import { warn } from '../utils/logger'
import type { ImageLoader } from './captcha-types'

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const SUPPORTED_IMAGE_CONTENT_TYPE =
  /^(?:image\/(?:jpeg|png|gif|webp))(?:[ \t]*;[ \t]*[!#$%&'*+.^_`|~0-9A-Za-z-]+[ \t]*=[ \t]*(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[\t\x20\x21\x23-\x5b\x5d-\x7e]|\\[\t\x20-\x7e])*"))*[ \t]*$/iu
const STRICT_CONTENT_LENGTH = /^(?:0|[1-9]\d*)$/u

function abortReason(signal: AbortSignal): Error | DOMException {
  const reason = signal.reason
  return reason instanceof Error || reason instanceof DOMException
    ? reason
    : new DOMException('图片请求已取消', 'AbortError')
}

function contentLength(response: Response): number | null {
  const value = response.headers.get('content-length')
  if (value === null) {
    return null
  }
  if (!STRICT_CONTENT_LENGTH.test(value)) {
    throw new Error('验证码图片 Content-Length 无效')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('验证码图片 Content-Length 无效')
  }
  return parsed
}

function contentType(response: Response): string {
  const value = response.headers.get('content-type')
  if (value === null || !SUPPORTED_IMAGE_CONTENT_TYPE.test(value)) {
    throw new Error('验证码图片 Content-Type 无效')
  }
  // HTTP 参数已完成校验；Blob 和跨上下文协议只携带规范化的基础图片类型。
  const parameterStart = value.indexOf(';')
  return (parameterStart === -1 ? value : value.slice(0, parameterStart)).trim().toLowerCase()
}

export class CachedImageLoader implements ImageLoader {
  constructor(private readonly requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) {}

  async get(url: string, signal?: AbortSignal): Promise<Blob> {
    if (signal?.aborted) {
      throw abortReason(signal)
    }

    try {
      return await this.attempt(url, 'only-if-cached', false, signal)
    } catch (error) {
      if (signal?.aborted) {
        throw abortReason(signal)
      }
      const firstError = error instanceof Error ? error.message : String(error)
      warn('仅缓存读取失败，使用网络回退', firstError)
      // The fallback gets its own full budget: a slow cache read must not
      // starve (or skip) the network attempt.
      return this.attempt(url, 'default', true, signal)
    }
  }

  private async attempt(
    url: string,
    cache: RequestCache,
    fallback: boolean,
    signal: AbortSignal | undefined,
  ): Promise<Blob> {
    const requestController = new AbortController()
    const forwardAbort = (): void => requestController.abort(signal ? abortReason(signal) : undefined)
    signal?.addEventListener('abort', forwardAbort, { once: true })
    const timeoutId = setTimeout(() => {
      requestController.abort(new DOMException(`图片请求超时 (${this.requestTimeoutMs}ms)`, 'TimeoutError'))
    }, this.requestTimeoutMs)
    try {
      return await this.fetchBlob(url, cache, requestController.signal, fallback)
    } finally {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }

  private async fetchBlob(url: string, cache: RequestCache, signal: AbortSignal, fallback: boolean): Promise<Blob> {
    const fetchImpl = resolveFetchImplementation()
    const response = await raceAbort(
      fetchImpl(url, {
        cache,
        mode: 'same-origin',
        credentials: 'include',
        signal,
      }),
      signal,
      () => abortReason(signal),
    )
    if (!response.ok) {
      cancelByteStream(response.body)
      const suffix = fallback ? ' (回退也失败)' : ''
      throw new Error(`图片缓存不可用: HTTP ${response.status}${suffix}`)
    }

    let readerAcquired = false
    try {
      const type = contentType(response)
      const declaredLength = contentLength(response)
      if (declaredLength !== null && declaredLength > imagePreprocessConfig.maxEncodedBytes) {
        throw new Error(`验证码图片数据超过限制: ${declaredLength}`)
      }
      if (!response.body) {
        throw new Error('验证码图片响应正文不可用')
      }
      readerAcquired = true
      const bytes = await readBoundedByteStream(response.body, {
        expectedByteLength: declaredLength,
        maxByteLength: imagePreprocessConfig.maxEncodedBytes,
        sizeError: (actual) =>
          new Error(
            actual > imagePreprocessConfig.maxEncodedBytes
              ? `验证码图片数据超过限制: ${actual}`
              : '验证码图片 Content-Length 与正文不匹配',
          ),
        wait: (promise) => raceAbort(promise, signal, () => abortReason(signal)),
      })
      if (signal.aborted) {
        throw abortReason(signal)
      }
      if (bytes.byteLength === 0) throw new Error('验证码图片数据为空')
      return new Blob([bytes], { type })
    } catch (error) {
      if (!readerAcquired) cancelByteStream(response.body, error)
      throw error
    }
  }
}
