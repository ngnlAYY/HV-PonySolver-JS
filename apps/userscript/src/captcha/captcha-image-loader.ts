import type { ImageLoader } from './captcha-types'

export class CachedImageLoader implements ImageLoader {
  async get(url: string): Promise<Blob> {
    const response = await fetch(url, {
      cache: 'only-if-cached',
      mode: 'same-origin',
      credentials: 'include',
    })
    if (!response.ok) {
      throw new Error(`图片缓存不可用: HTTP ${response.status}`)
    }
    return response.blob()
  }
}
