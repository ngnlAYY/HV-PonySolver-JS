export interface ImageLoader {
  get(url: string): Promise<Blob>
}
