import { inferenceTimeoutConfig } from '../inference/inference-config'
import { ModelDownloadQuotaExceededError } from './model-download-error'
import { modelConfig } from './model-config'
import type { ModelIntegrity } from './model-integrity'
import { verifyModelIntegrity } from './model-integrity'

export type ModelIntegrityOptions = Readonly<{
  accessKeyOverride?: string
  integrity?: ModelIntegrity
  verifyIntegrity?: boolean
  forceVerifyIntegrity?: boolean
}>

export type ModelDownloadEnvironment = Readonly<{
  fetchImpl?: typeof fetch
  getAccessKey?: (signal?: AbortSignal) => Promise<string>
}>

type DownloadDeadline = Readonly<{
  signal: AbortSignal
  run<T>(operation: () => T | PromiseLike<T>): Promise<T>
  runPromise<T>(promise: PromiseLike<T>): Promise<T>
  throwIfExpired(): void
  dispose(): void
}>

function createDownloadDeadline(callerSignal?: AbortSignal): DownloadDeadline {
  const controller = new AbortController()
  let reason: 'caller' | 'timeout' | null = null
  const error = (): Error => (reason === 'timeout' ? new Error('模型下载超时') : new Error('模型下载已取消'))
  const abortFromCaller = (): void => {
    if (reason !== null) {
      return
    }
    reason = 'caller'
    controller.abort(error())
  }
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeoutId = setTimeout(() => {
    if (reason !== null) {
      return
    }
    reason = 'timeout'
    controller.abort(error())
  }, inferenceTimeoutConfig.modelDownloadTimeoutMs)
  if (callerSignal?.aborted) {
    abortFromCaller()
  }

  const throwIfExpired = (): void => {
    if (controller.signal.aborted) {
      throw error()
    }
  }

  const runPromise = <T>(promise: PromiseLike<T>): Promise<T> => {
    if (controller.signal.aborted) {
      void Promise.resolve(promise).catch(() => undefined)
      return Promise.reject(error())
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const cleanup = (): void => controller.signal.removeEventListener('abort', onAbort)
      const finish = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        callback()
      }
      const onAbort = (): void => finish(() => reject(error()))
      controller.signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve(promise).then(
        (value) => finish(() => resolve(value)),
        (operationError: unknown) => finish(() => reject(operationError)),
      )
      if (controller.signal.aborted) {
        onAbort()
      }
    })
  }

  return {
    signal: controller.signal,
    run<T>(operation: () => T | PromiseLike<T>): Promise<T> {
      throwIfExpired()
      try {
        return runPromise(Promise.resolve(operation()))
      } catch (operationError) {
        return Promise.reject(operationError)
      }
    },
    runPromise,
    throwIfExpired,
    dispose(): void {
      clearTimeout(timeoutId)
      callerSignal?.removeEventListener('abort', abortFromCaller)
    },
  }
}

function resolveIntegrityOptions(options: ModelIntegrityOptions = {}): {
  integrity: ModelIntegrity
  verifyIntegrity: boolean
} {
  return {
    integrity: options.integrity ?? modelConfig.integrity,
    verifyIntegrity: options.forceVerifyIntegrity ? true : (options.verifyIntegrity ?? modelConfig.verifyIntegrity),
  }
}

function getModelUrl(): string {
  if (!modelConfig.urlBase) {
    throw new Error('模型下载地址未配置')
  }
  return modelConfig.urlBase
}

async function getRequestAccessKey(
  accessKeyOverride: string | undefined,
  getAccessKey: ((signal?: AbortSignal) => Promise<string>) | undefined,
  signal: AbortSignal,
): Promise<string> {
  const candidateAccessKey = accessKeyOverride?.trim()
  if (candidateAccessKey) {
    return candidateAccessKey
  }
  const storedAccessKey = getAccessKey ? await getAccessKey(signal) : ''
  return storedAccessKey.trim() || modelConfig.accessKey.trim()
}

function createModelFetchInit(signal: AbortSignal, accessKey: string): RequestInit {
  const init: RequestInit = { cache: 'no-store', signal }
  if (accessKey) {
    init.headers = { authorization: `Bearer ${accessKey}` }
  }
  return init
}

const contentLengthPattern = /^[0-9]+$/

function parseRetryAfterSeconds(value: string | null): number | null {
  if (value === null || !contentLengthPattern.test(value)) {
    return null
  }
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null
}

async function cancelResponseBody(response: Response, deadline: DownloadDeadline): Promise<void> {
  try {
    const cancellation = response.body?.cancel()
    if (cancellation) {
      await deadline.runPromise(cancellation)
    }
  } catch {
    // The primary HTTP/read error remains authoritative if cleanup fails or times out.
  }
}

function parseDeclaredByteLength(contentLength: string | null): number | null {
  if (contentLength === null) {
    return null
  }
  if (!contentLengthPattern.test(contentLength)) {
    throw new Error(`下载模型大小校验失败: ${contentLength}`)
  }
  const byteLength = Number(contentLength)
  if (!Number.isSafeInteger(byteLength)) {
    throw new Error(`下载模型大小校验失败: ${contentLength}`)
  }
  return byteLength
}

function assertDeclaredByteLength(actualByteLength: number, declaredByteLength: number | null): void {
  if (declaredByteLength !== null && actualByteLength !== declaredByteLength) {
    throw new Error(`下载模型大小校验失败: ${actualByteLength} != ${declaredByteLength}`)
  }
}

function assertModelByteLength(buffer: ArrayBuffer, expectedByteLength: number | null, maxByteLength: number): void {
  if (expectedByteLength !== null && buffer.byteLength > expectedByteLength) {
    throw new Error(`下载模型大小校验失败: ${buffer.byteLength} != ${expectedByteLength}`)
  }
  if (buffer.byteLength > maxByteLength) {
    throw new Error(`下载模型大小校验失败: ${buffer.byteLength} > ${maxByteLength}`)
  }
}

async function readModelResponse(
  response: Response,
  expectedByteLength: number | null,
  maxByteLength: number,
  deadline: DownloadDeadline,
): Promise<ArrayBuffer> {
  const contentLength = response.headers.get('content-length')
  let declaredByteLength: number | null
  try {
    declaredByteLength = parseDeclaredByteLength(contentLength)
  } catch (error) {
    await cancelResponseBody(response, deadline)
    throw error
  }
  if (expectedByteLength !== null && declaredByteLength !== null && declaredByteLength > expectedByteLength) {
    await cancelResponseBody(response, deadline)
    throw new Error(`下载模型大小校验失败: ${contentLength} != ${expectedByteLength}`)
  }
  if (declaredByteLength !== null && declaredByteLength > maxByteLength) {
    await cancelResponseBody(response, deadline)
    throw new Error(`下载模型大小校验失败: ${contentLength} > ${maxByteLength}`)
  }
  if (!response.body) {
    const buffer = await deadline.run(() => response.arrayBuffer())
    assertDeclaredByteLength(buffer.byteLength, declaredByteLength)
    assertModelByteLength(buffer, expectedByteLength, maxByteLength)
    return buffer
  }
  const expectedContentLength = declaredByteLength === null ? expectedByteLength : declaredByteLength
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  const bytes = expectedContentLength === null ? null : new Uint8Array(expectedContentLength)
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await deadline.run(() => reader.read())
      if (done) {
        break
      }
      const nextTotalBytes = totalBytes + value.byteLength
      if (expectedContentLength !== null && nextTotalBytes > expectedContentLength) {
        throw new Error(`下载模型大小校验失败: ${nextTotalBytes} != ${expectedContentLength}`)
      }
      if (expectedByteLength !== null && nextTotalBytes > expectedByteLength) {
        throw new Error(`下载模型大小校验失败: ${nextTotalBytes} != ${expectedByteLength}`)
      }
      if (nextTotalBytes > maxByteLength) {
        throw new Error(`下载模型大小校验失败: ${nextTotalBytes} > ${maxByteLength}`)
      }
      if (bytes) {
        bytes.set(value, totalBytes)
      } else {
        chunks.push(value)
      }
      totalBytes = nextTotalBytes
    }
    if (bytes) {
      if (totalBytes !== expectedContentLength) {
        throw new Error(`下载模型大小校验失败: ${totalBytes} != ${expectedContentLength}`)
      }
      return bytes.buffer
    }
    const mergedBytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      mergedBytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return mergedBytes.buffer
  } catch (error) {
    try {
      await deadline.runPromise(reader.cancel())
    } catch {
      // Preserve the read/validation/deadline error.
    }
    throw error
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Reader cleanup must not mask the primary result or error.
    }
  }
}

export async function downloadModel(
  signal?: AbortSignal,
  options: ModelIntegrityOptions = {},
  environment: ModelDownloadEnvironment = {},
): Promise<ArrayBuffer> {
  const { integrity, verifyIntegrity } = resolveIntegrityOptions(options)
  const deadline = createDownloadDeadline(signal)
  try {
    deadline.throwIfExpired()
    const accessKey = await deadline.run(() =>
      getRequestAccessKey(options.accessKeyOverride, environment.getAccessKey, deadline.signal),
    )
    const response = await deadline.run(() =>
      (environment.fetchImpl ?? fetch)(getModelUrl(), createModelFetchInit(deadline.signal, accessKey)),
    )
    if (!response.ok) {
      await cancelResponseBody(response, deadline)
      deadline.throwIfExpired()
      if (response.status === 429) {
        throw new ModelDownloadQuotaExceededError(parseRetryAfterSeconds(response.headers.get('retry-after')))
      }
      throw new Error(`模型下载失败: HTTP ${response.status}`)
    }
    const buffer = await readModelResponse(
      response,
      verifyIntegrity ? integrity.byteLength : null,
      integrity.byteLength,
      deadline,
    )
    if (verifyIntegrity) {
      await deadline.run(() => verifyModelIntegrity(buffer, integrity, '下载模型'))
    }
    deadline.throwIfExpired()
    return buffer
  } finally {
    deadline.dispose()
  }
}
