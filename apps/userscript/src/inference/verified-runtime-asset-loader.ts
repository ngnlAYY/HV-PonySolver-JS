import { resolveFetchImplementation } from '@hv-pony-solver/browser-core/platform/fetch'
import { raceAbort } from '@hv-pony-solver/browser-core/utils/abort-race'

export type VerifiedRuntimeAsset = Readonly<{
  url: string
  byteLength: number
  sha256: string
  maxByteLength: number
}>

function abortReason(signal: AbortSignal | undefined, label: string): unknown {
  return signal?.reason ?? new DOMException(`${label} 下载已取消`, 'AbortError')
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason?: unknown): void {
  try {
    void reader.cancel(reason).catch(() => undefined)
  } catch {
    // Cancellation is best-effort cleanup and must not replace the primary error.
  }
}

function cancelBody(body: ReadableStream<Uint8Array> | null, reason?: unknown): void {
  try {
    void body?.cancel(reason).catch(() => undefined)
  } catch {
    // Cancellation is best-effort cleanup and must not replace the primary error.
  }
}

async function readBoundedResponse(
  response: Response,
  maxByteLength: number,
  label: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!response.body) {
    // arrayBuffer() would allocate the complete response before the hard cap
    // can be enforced. Normal successful fetch responses expose a stream.
    throw new Error(`${label} 响应正文不可用`)
  }

  const reader = response.body.getReader()
  const declaredLength = response.headers.get('content-length')
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength)
      if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxByteLength) {
        throw new Error(`${label} 响应大小无效`)
      }
    }
    while (true) {
      const { done, value } = await raceAbort(reader.read(), signal, () => abortReason(signal, label))
      if (done) break
      if (!value) continue
      byteLength += value.byteLength
      if (byteLength > maxByteLength) {
        throw new Error(`${label} 超过大小上限`)
      }
      chunks.push(value)
    }
  } catch (error) {
    cancelReader(reader, error)
    throw error
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // A still-pending read may temporarily keep the reader locked after abort.
    }
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
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    throw abortReason(signal, label)
  }
  const responsePromise = resolveFetchImplementation(fetchImpl)(expected.url, {
    cache: 'force-cache',
    redirect: 'error',
    ...(signal ? { signal } : {}),
  })
  if (signal) {
    void responsePromise.then(
      (lateResponse) => {
        if (signal.aborted) {
          cancelBody(lateResponse.body, abortReason(signal, label))
        }
      },
      () => undefined,
    )
  }
  const response = await raceAbort(responsePromise, signal, () => abortReason(signal, label))
  if (signal?.aborted) {
    const error = abortReason(signal, label)
    cancelBody(response.body, error)
    throw error
  }
  if (!response.ok) {
    const error = new Error(`${label} 下载失败: HTTP ${response.status}`)
    cancelBody(response.body, error)
    throw error
  }
  const buffer = await readBoundedResponse(response, expected.maxByteLength, label, signal)
  if (buffer.byteLength !== expected.byteLength) {
    throw new Error(`${label} 大小校验失败`)
  }
  if ((await raceAbort(sha256Hex(buffer), signal, () => abortReason(signal, label))) !== expected.sha256) {
    throw new Error(`${label} SHA-256 校验失败`)
  }
  return buffer
}
