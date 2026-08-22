export type PackagedAssetIntegrity = Readonly<{
  byteLength: number
  sha256: string
}>

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel()
  } catch {
    // Cancellation is best-effort cleanup and must not replace the primary error.
  }
}

function declaredLength(response: Response, label: string): number | null {
  const value = response.headers.get('content-length')
  if (value === null) {
    return null
  }
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${label} Content-Length 无效`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} Content-Length 无效`)
  }
  return parsed
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readExactBody(
  body: ReadableStream<Uint8Array>,
  expectedByteLength: number,
  label: string,
): Promise<ArrayBuffer> {
  const reader = body.getReader()
  const output = new Uint8Array(expectedByteLength)
  let offset = 0
  let primaryError: unknown
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (offset + value.byteLength > expectedByteLength) {
        throw new Error(`${label} 大小校验失败`)
      }
      output.set(value, offset)
      offset += value.byteLength
    }
    if (offset !== expectedByteLength) {
      throw new Error(`${label} 大小校验失败`)
    }
  } catch (error) {
    primaryError = error
    try {
      await reader.cancel()
    } catch {
      // Preserve the read, length, or integrity error that caused cancellation.
    }
  } finally {
    reader.releaseLock()
  }
  if (primaryError !== undefined) {
    throw primaryError
  }
  return output.buffer
}

export async function loadPackagedAsset(
  url: string,
  integrity: PackagedAssetIntegrity,
  label: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const init: RequestInit = { cache: 'force-cache', redirect: 'error' }
  if (signal) {
    init.signal = signal
  }
  const response = await fetchImpl(url, init)
  if (signal?.aborted) {
    await cancelBody(response.body)
    throw new Error(`${label} 加载已取消`)
  }
  if (!response.ok) {
    await cancelBody(response.body)
    throw new Error(`${label} 读取失败: HTTP ${response.status}`)
  }

  let contentLength: number | null
  try {
    contentLength = declaredLength(response, label)
  } catch (error) {
    await cancelBody(response.body)
    throw error
  }
  if (contentLength !== null && contentLength !== integrity.byteLength) {
    await cancelBody(response.body)
    throw new Error(`${label} 大小校验失败`)
  }
  if (!response.body) {
    throw new Error(`${label} 响应正文不可用`)
  }

  const buffer = await readExactBody(response.body, integrity.byteLength, label)
  if (signal?.aborted) {
    throw new Error(`${label} 加载已取消`)
  }
  if ((await sha256Hex(buffer)) !== integrity.sha256) {
    throw new Error(`${label} 完整性校验失败`)
  }
  return buffer
}
