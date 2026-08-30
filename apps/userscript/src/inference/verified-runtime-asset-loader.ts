import { resolveFetchImplementation } from '@hv-pony-solver/browser-core/platform/fetch'

export type VerifiedRuntimeAsset = Readonly<{
  url: string
  byteLength: number
  sha256: string
  maxByteLength: number
}>

async function readBoundedResponse(response: Response, maxByteLength: number, label: string): Promise<ArrayBuffer> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxByteLength) {
      throw new Error(`${label} 响应大小无效`)
    }
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > maxByteLength) {
      throw new Error(`${label} 超过大小上限`)
    }
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      byteLength += value.byteLength
      if (byteLength > maxByteLength) {
        await reader.cancel()
        throw new Error(`${label} 超过大小上限`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function loadVerifiedRuntimeAsset(
  label: string,
  expected: VerifiedRuntimeAsset,
  fetchImpl: typeof fetch | undefined = undefined,
): Promise<ArrayBuffer> {
  const response = await resolveFetchImplementation(fetchImpl)(expected.url, {
    cache: 'force-cache',
    redirect: 'error',
  })
  if (!response.ok) {
    throw new Error(`${label} 下载失败: HTTP ${response.status}`)
  }
  const buffer = await readBoundedResponse(response, expected.maxByteLength, label)
  if (buffer.byteLength !== expected.byteLength) {
    throw new Error(`${label} 大小校验失败`)
  }
  if ((await sha256Hex(buffer)) !== expected.sha256) {
    throw new Error(`${label} SHA-256 校验失败`)
  }
  return buffer
}
