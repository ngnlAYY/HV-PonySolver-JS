import { resolveFetchImplementation } from '@hv-pony-solver/browser-core/platform/fetch'
import {
  cancelByteStream as cancelBody,
  readBoundedByteStream,
  sha256Hex,
} from '@hv-pony-solver/browser-core/platform/byte-stream'
import { raceAbort } from '@hv-pony-solver/browser-core/utils/abort-race'

export type VerifiedRuntimeAsset = Readonly<{
  url: string
  byteLength: number
  sha256: string
  maxByteLength: number
}>

function abortReason(signal: AbortSignal | undefined, label: string): Error | DOMException {
  const reason = signal?.reason
  return reason instanceof Error || reason instanceof DOMException
    ? reason
    : new DOMException(`${label} 下载已取消`, 'AbortError')
}

function cancelLateResponse(responsePromise: Promise<Response>, signal: AbortSignal, label: string): void {
  responsePromise
    .then(
      (lateResponse) => {
        if (signal.aborted) {
          cancelBody(lateResponse.body, abortReason(signal, label))
        }
      },
      () => undefined,
    )
    .catch(() => undefined)
}

async function readBoundedResponse(
  response: Response,
  expected: VerifiedRuntimeAsset,
  label: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!response.body) {
    // arrayBuffer() would allocate the complete response before the hard cap
    // can be enforced. Normal successful fetch responses expose a stream.
    throw new Error(`${label} 响应正文不可用`)
  }

  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > expected.maxByteLength) {
      const error = new Error(`${label} 响应大小无效`)
      cancelBody(response.body, error)
      throw error
    }
  }
  return readBoundedByteStream(response.body, {
    expectedByteLength: expected.byteLength,
    maxByteLength: expected.maxByteLength,
    sizeError: (actual) =>
      new Error(actual > expected.maxByteLength ? `${label} 超过大小上限` : `${label} 大小校验失败`),
    wait: (promise) => raceAbort(promise, signal, () => abortReason(signal, label)),
  })
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
  const requestInit: RequestInit = {
    cache: 'force-cache',
    redirect: 'error',
  }
  if (signal) {
    requestInit.signal = signal
  }
  const responsePromise = resolveFetchImplementation(fetchImpl)(expected.url, requestInit)
  if (signal) {
    cancelLateResponse(responsePromise, signal, label)
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
  const buffer = await readBoundedResponse(response, expected, label, signal)
  if ((await raceAbort(sha256Hex(buffer), signal, () => abortReason(signal, label))) !== expected.sha256) {
    throw new Error(`${label} SHA-256 校验失败`)
  }
  return buffer
}
