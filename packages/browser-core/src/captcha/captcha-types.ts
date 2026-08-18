export interface ImageLoader {
  get(url: string, signal?: AbortSignal): Promise<Blob>
}
