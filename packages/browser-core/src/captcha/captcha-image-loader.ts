import { imagePreprocessConfig } from '../inference/inference-config'
import { warn } from '../utils/logger'
import type { ImageLoader } from './captcha-types'

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const SUPPORTED_IMAGE_CONTENT_TYPE = /^(?:image\/(?:jpeg|png|gif|webp))(?:[ \t]*;[ \t]*[!#$%&'*+.^_`|~0-9A-Za-z-]+[ \t]*=[ \t]*(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[\t\x20\x21\x23-\x5b\x5d-\x7e]|\\[\t\x20-\x7e])*"))*[ \t]*$/iu
const STRICT_CONTENT_LENGTH = /^(?:0|[1-9]\d*)$/u

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('图片请求已取消', 'AbortError')
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal))
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    const onAbort = (): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(abortReason(signal))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        reject(error)
      },
    )
    if (signal.aborted) {
      onAbort()
    }
  })
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
  return value
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    const cancellation = reader.cancel()
    void cancellation.catch(() => undefined)
  } catch {
    // Cancellation is best-effort cleanup and must not replace the primary error.
  }
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  declaredLength: number | null,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let actualLength = 0
  try {
    while (true) {
      const { done, value } = await waitForAbort(reader.read(), signal)
      if (done) {
        break
      }
      actualLength += value.byteLength
      if (actualLength > imagePreprocessConfig.maxEncodedBytes) {
        throw new Error(`验证码图片数据超过限制: ${actualLength}`)
      }
      if (declaredLength !== null && actualLength > declaredLength) {
        throw new Error('验证码图片 Content-Length 与正文不匹配')
      }
      chunks.push(value)
    }
    if (actualLength < 1) {
      throw new Error('验证码图片数据为空')
    }
    if (declaredLength !== null && actualLength !== declaredLength) {
      throw new Error('验证码图片 Content-Length 与正文不匹配')
    }
  } catch (error) {
    cancelReader(reader)
    throw error
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Releasing a failed or still-pending reader is best-effort cleanup.
    }
  }

  const output = new Uint8Array(new ArrayBuffer(actualLength))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
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
    const response = await waitForAbort(
      fetch(url, {
        cache,
        mode: 'same-origin',
        credentials: 'include',
        signal,
      }),
      signal,
    )
    if (!response.ok) {
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
      const bytes = await readBoundedBody(response.body, declaredLength, signal)
      if (signal.aborted) {
        throw abortReason(signal)
      }
      return new Blob([bytes.buffer], { type })
    } catch (error) {
      if (!readerAcquired) {
        try {
          await response.body?.cancel()
        } catch {
          // Cancellation is best-effort cleanup and must not replace the primary error.
        }
      }
      throw error
    }
  }
}
