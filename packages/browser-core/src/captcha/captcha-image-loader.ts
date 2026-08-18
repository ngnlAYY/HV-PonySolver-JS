import { warn } from '../utils/logger'
import type { ImageLoader } from './captcha-types'

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

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

export class CachedImageLoader implements ImageLoader {
  constructor(private readonly requestTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) {}

  async get(url: string, signal?: AbortSignal): Promise<Blob> {
    if (signal?.aborted) {
      throw abortReason(signal)
    }

    const requestController = new AbortController()
    const forwardAbort = (): void => requestController.abort(signal ? abortReason(signal) : undefined)
    signal?.addEventListener('abort', forwardAbort, { once: true })
    const timeoutId = setTimeout(() => {
      requestController.abort(new DOMException(`图片请求超时 (${this.requestTimeoutMs}ms)`, 'TimeoutError'))
    }, this.requestTimeoutMs)

    try {
      return await this.getWithSignal(url, requestController.signal)
    } finally {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }

  private async getWithSignal(url: string, signal: AbortSignal): Promise<Blob> {
    let firstError: string
    try {
      return await this.fetchBlob(url, 'only-if-cached', signal, false)
    } catch (error: unknown) {
      if (signal.aborted) {
        throw abortReason(signal)
      }
      firstError = error instanceof Error ? error.message : String(error)
    }

    warn('仅缓存读取失败，使用网络回退', firstError)
    return this.fetchBlob(url, 'default', signal, true)
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
    return waitForAbort(response.blob(), signal)
  }
}
