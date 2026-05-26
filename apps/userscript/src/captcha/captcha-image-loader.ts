import type { ImageLoader } from './captcha-types'
import { warn } from '../utils/logger'

export class CachedImageLoader implements ImageLoader {
  async get(url: string): Promise<Blob> {
    // 先尝试仅缓存读取
    let firstError: string | null = null
    try {
      const cachedResponse = await fetch(url, {
        cache: 'only-if-cached',
        mode: 'same-origin',
        credentials: 'include',
      })
      if (cachedResponse.ok) {
        return cachedResponse.blob()
      }
      firstError = `图片缓存不可用: HTTP ${cachedResponse.status}`
    } catch (e: unknown) {
      firstError = e instanceof Error ? e.message : String(e)
    }

    // 仅缓存失败，回退到普通网络请求
    warn('仅缓存读取失败，使用网络回退', firstError)
    const fallbackResponse = await fetch(url, {
      cache: 'default',
      mode: 'same-origin',
      credentials: 'include',
    })
    if (!fallbackResponse.ok) {
      throw new Error(`图片缓存不可用: HTTP ${fallbackResponse.status} (回退也失败)`)
    }
    return fallbackResponse.blob()
  }
}
