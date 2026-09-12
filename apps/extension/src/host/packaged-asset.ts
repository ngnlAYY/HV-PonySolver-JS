import { ModelIntegrityVerificationError } from '@hv-pony-solver/browser-core/model/permanent-model-error'
import { resolveFetchImplementation } from '@hv-pony-solver/browser-core/platform/fetch'
import { cancelByteStream, readBoundedByteStream, sha256Hex } from '@hv-pony-solver/browser-core/platform/byte-stream'
import { raceAbort } from '@hv-pony-solver/browser-core/utils/abort-race'

export type PackagedAssetIntegrity = Readonly<{
  byteLength: number
  sha256: string
}>

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  cancelByteStream(body)
}

function declaredLength(response: Response, label: string): number | null {
  const value = response.headers.get('content-length')
  if (value === null) {
    return null
  }
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new ModelIntegrityVerificationError(`${label} Content-Length 无效`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new ModelIntegrityVerificationError(`${label} Content-Length 无效`)
  }
  return parsed
}

function abortError(label: string): Error {
  return new Error(`${label} 加载已取消`)
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, label: string): Promise<T> {
  return raceAbort(promise, signal, () => abortError(label))
}

async function readExactBody(
  body: ReadableStream<Uint8Array>,
  expectedByteLength: number,
  label: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  return readBoundedByteStream(body, {
    expectedByteLength,
    maxByteLength: expectedByteLength,
    sizeError: () => new ModelIntegrityVerificationError(`${label} 大小校验失败`),
    wait: (promise) => raceAbort(promise, signal, () => abortError(label)),
  })
}

export async function loadPackagedAsset(
  url: string,
  integrity: PackagedAssetIntegrity,
  label: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const init: RequestInit = { cache: 'force-cache', redirect: 'error' }
  if (signal) {
    init.signal = signal
  }
  const response = await resolveFetchImplementation(fetchImpl)(url, init)
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
    throw new ModelIntegrityVerificationError(`${label} 大小校验失败`)
  }
  if (!response.body) {
    throw new Error(`${label} 响应正文不可用`)
  }

  const buffer = await readExactBody(response.body, integrity.byteLength, label, signal)
  if (signal?.aborted) {
    throw abortError(label)
  }
  const digest = await waitForAbort(sha256Hex(buffer), signal, label)
  if (signal?.aborted) {
    throw abortError(label)
  }
  if (digest !== integrity.sha256) {
    throw new ModelIntegrityVerificationError(`${label} 完整性校验失败`)
  }
  return buffer
}
