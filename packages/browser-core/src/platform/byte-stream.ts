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

/** 已知长度直接写入最终缓冲；未知长度按需倍增，避免保留任意数量的分块及其底层缓冲。 */
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
  let offset = 0
  try {
    let output = new Uint8Array(expectedByteLength ?? 0)
    while (true) {
      const pending = reader.read()
      const { done, value } = await (options.wait ? options.wait(pending) : pending)
      if (done) break
      if (!value?.byteLength) continue
      const nextOffset = offset + value.byteLength
      if (nextOffset > limit) throw sizeError(nextOffset, limit)
      if (nextOffset > output.byteLength) {
        const capacity = Math.min(limit, Math.max(nextOffset, output.byteLength * 2, 64 * 1024))
        const grown = new Uint8Array(capacity)
        grown.set(output)
        output = grown
      }
      output.set(value, offset)
      offset = nextOffset
    }
    if (expectedByteLength !== null && offset !== expectedByteLength) throw sizeError(offset, expectedByteLength)
    return offset === output.byteLength ? output.buffer : output.slice(0, offset).buffer
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
