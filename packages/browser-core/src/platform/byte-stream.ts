export type ByteStreamOptions = Readonly<{
  expectedByteLength: number | null
  maxByteLength: number
  sizeError: (actual: number, limit: number) => Error
  wait?: <T>(promise: PromiseLike<T>) => Promise<T>
}>

export function cancelByteStream(body: Pick<ReadableStream<Uint8Array>, 'cancel'> | null, reason?: unknown): void {
  try {
    void body?.cancel(reason).catch(() => undefined)
  } catch {
    // 清理不能覆盖原始错误，也不能等待一个不响应取消的流。
  }
}

/** 已知身份的资产直接写入最终缓冲；只有未知长度的响应才保留有界分块。 */
export async function readBoundedByteStream(
  body: ReadableStream<Uint8Array>,
  options: ByteStreamOptions,
): Promise<ArrayBuffer> {
  const { expectedByteLength, maxByteLength, sizeError } = options
  const limit = expectedByteLength ?? maxByteLength
  if (
    !Number.isSafeInteger(maxByteLength) ||
    maxByteLength < 0 ||
    (expectedByteLength !== null &&
      (!Number.isSafeInteger(expectedByteLength) || expectedByteLength < 0 || expectedByteLength > maxByteLength))
  ) {
    cancelByteStream(body)
    throw new Error('资产长度契约无效')
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let offset = 0
  try {
    const output = expectedByteLength === null ? null : new Uint8Array(expectedByteLength)
    while (true) {
      const pending = reader.read()
      const { done, value } = await (options.wait ? options.wait(pending) : pending)
      if (done) break
      if (!value) continue
      const nextOffset = offset + value.byteLength
      if (nextOffset > limit) throw sizeError(nextOffset, limit)
      if (output) output.set(value, offset)
      else chunks.push(value)
      offset = nextOffset
    }
    if (output) {
      if (offset !== output.byteLength) throw sizeError(offset, output.byteLength)
      return output.buffer
    }
    const merged = new Uint8Array(offset)
    let written = 0
    for (const chunk of chunks) {
      merged.set(chunk, written)
      written += chunk.byteLength
    }
    return merged.buffer
  } catch (error) {
    cancelByteStream(reader, error)
    throw error
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // 取消时仍未完成的 read 可能暂时持有锁。
    }
  }
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
