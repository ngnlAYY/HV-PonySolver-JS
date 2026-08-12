export type ModelIntegrity = Readonly<{
  byteLength: number
  sha256: string
}>

export async function verifyModelIntegrity(buffer: ArrayBuffer, integrity: ModelIntegrity, source: string): Promise<void> {
  if (buffer.byteLength !== integrity.byteLength) {
    throw new Error(`${source}大小校验失败: ${buffer.byteLength} != ${integrity.byteLength}`)
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  if (sha256 !== integrity.sha256) {
    throw new Error(`${source} SHA-256 校验失败`)
  }
}
