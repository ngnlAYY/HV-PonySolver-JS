import { inferenceTimeoutConfig } from '../inference/inference-config'
import { resolveFetchImplementation } from '../platform/fetch'
import { cancelByteStream, readBoundedByteStream, sha256Hex } from '../platform/byte-stream'
import { raceAbort } from '../utils/abort-race'
import {
  MODEL_DOWNLOAD_RECEIPT_HEADER,
  MODEL_MONTHLY_DOWNLOAD_LIMIT,
  normalizeModelDownloadReceiptId,
} from '@hv-pony-solver/shared'
import {
  clearModelDownloadConfirmation,
  getModelDownloadConfirmation,
  registerModelDownloadConfirmation,
} from './model-download-confirmation-store'
import { ModelAccessKeyRejectedError, ModelDownloadQuotaExceededError } from './model-download-error'
import { modelConfig } from './model-config'
import { type ModelIntegrityOptions, resolveIntegrityOptions } from './model-integrity'
import { ModelIntegrityVerificationError } from './permanent-model-error'

export type { ModelIntegrityOptions } from './model-integrity'

export type ModelDownloadEnvironment = Readonly<{
  fetchImpl?: typeof fetch
  getAccessKey?: (signal?: AbortSignal) => Promise<string>
}>

export { copyModelDownloadConfirmation } from './model-download-confirmation-store'

const MODEL_JSON_RESPONSE_MAX_BYTES = 16 * 1024

type DownloadDeadline = Readonly<{
  signal: AbortSignal
  run<T>(operation: () => T | PromiseLike<T>): Promise<T>
  runPromise<T>(promise: PromiseLike<T>): Promise<T>
  throwIfExpired(): void
  dispose(): void
}>

function createDownloadDeadline(
  callerSignal?: AbortSignal,
  label: string = '模型下载',
  timeoutMs: number = inferenceTimeoutConfig.modelDownloadTimeoutMs,
): DownloadDeadline {
  const controller = new AbortController()
  let reason: 'caller' | 'timeout' | null = null
  const error = (): Error => new Error(reason === 'timeout' ? `${label}超时` : `${label}已取消`)
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
  }, timeoutMs)
  if (callerSignal?.aborted) {
    abortFromCaller()
  }

  const throwIfExpired = (): void => {
    if (controller.signal.aborted) {
      throw error()
    }
  }

  const runPromise = <T>(promise: PromiseLike<T>): Promise<T> => raceAbort(promise, controller.signal, error)

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

async function fetchModelResponse(deadline: DownloadDeadline, request: () => Promise<Response>): Promise<Response> {
  deadline.throwIfExpired()
  const pendingResponse = request()
  try {
    const response = await deadline.runPromise(pendingResponse)
    deadline.throwIfExpired()
    return response
  } catch (error) {
    // 取消只结束等待；不响应信号的 fetch 迟到返回时仍须释放正文。
    void pendingResponse.then((response) => cancelByteStream(response.body, error)).catch(() => undefined)
    throw error
  }
}

async function readModelJsonResponse(response: Response, deadline: DownloadDeadline, label: string): Promise<unknown> {
  if (!response.body) {
    throw new Error(`${label}响应正文不可用`)
  }
  const bytes = await readBoundedByteStream(response.body, {
    expectedByteLength: null,
    maxByteLength: MODEL_JSON_RESPONSE_MAX_BYTES,
    sizeError: () => new Error(`${label}响应超过大小限制`),
    wait: deadline.runPromise,
  })
  deadline.throwIfExpired()
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return value
  } catch {
    // 原生 JSON 解析错误可能包含响应正文，不向界面或日志透传。
    throw new Error(`${label}响应格式无效`)
  }
}

function getModelUrl(): string {
  if (!modelConfig.urlBase) {
    throw new Error('模型下载地址未配置')
  }
  return modelConfig.urlBase
}

function getQuotaUrl(): string {
  if (!modelConfig.quotaUrl) {
    throw new Error('模型下载次数查询地址未配置')
  }
  return modelConfig.quotaUrl
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
  const init: RequestInit = { cache: 'no-store', redirect: 'error', signal }
  if (accessKey) {
    init.headers = { authorization: `Bearer ${accessKey}` }
  }
  return init
}

function createModelConfirmationInit(signal: AbortSignal, accessKey: string, receiptId: string): RequestInit {
  const base = createModelFetchInit(signal, accessKey)
  const headers = new Headers(base.headers)
  headers.set(MODEL_DOWNLOAD_RECEIPT_HEADER, receiptId)
  return { ...base, headers, method: 'POST' }
}

const contentLengthPattern = /^[0-9]+$/

function isDecoySizedResponse(response: Response, actualByteLength: number, expectedByteLength: number): boolean {
  const contentLength = response.headers.get('content-length')
  return (
    contentLength !== null &&
    Number(contentLength) * 2 < expectedByteLength &&
    actualByteLength * 2 < expectedByteLength
  )
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (value === null || !contentLengthPattern.test(value)) {
    return null
  }
  const seconds = Number(value)
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null
}

function captureModelDownloadConfirmation(
  response: Response,
  buffer: ArrayBuffer,
  accessKey: string,
  fetchImpl: typeof fetch,
): ArrayBuffer {
  const rawReceiptId = response.headers.get(MODEL_DOWNLOAD_RECEIPT_HEADER)
  if (rawReceiptId === null) {
    return buffer
  }
  const receiptId = normalizeModelDownloadReceiptId(rawReceiptId)
  if (receiptId === null) {
    throw new Error('模型下载确认凭证无效')
  }
  registerModelDownloadConfirmation(buffer, { accessKey, fetchImpl, receiptId })
  return buffer
}

export async function confirmCachedModelDownload(buffer: ArrayBuffer, signal?: AbortSignal): Promise<void> {
  const confirmation = getModelDownloadConfirmation(buffer)
  if (!confirmation) {
    return
  }
  const deadline = createDownloadDeadline(signal, '模型下载缓存确认', inferenceTimeoutConfig.modelProbeTimeoutMs)
  try {
    const response = await fetchModelResponse(deadline, () =>
      confirmation.fetchImpl(
        getQuotaUrl(),
        createModelConfirmationInit(deadline.signal, confirmation.accessKey, confirmation.receiptId),
      ),
    )
    if (!response.ok) {
      cancelByteStream(response.body)
      deadline.throwIfExpired()
      if (response.status === 403) {
        throw new ModelAccessKeyRejectedError()
      }
      if (response.status === 429) {
        throw new ModelDownloadQuotaExceededError(parseRetryAfterSeconds(response.headers.get('retry-after')))
      }
      if (response.status === 409) {
        throw new Error('模型已缓存，但下载次数确认凭证已失效')
      }
      throw new Error(`模型已缓存，但下载次数确认失败: HTTP ${response.status}`)
    }
    const value = await readModelJsonResponse(response, deadline, '模型下载缓存确认')
    if (typeof value !== 'object' || value === null || (value as { confirmed?: unknown }).confirmed !== true) {
      throw new Error('模型已缓存，但下载次数确认响应无效')
    }
    deadline.throwIfExpired()
    clearModelDownloadConfirmation(buffer, confirmation)
  } finally {
    deadline.dispose()
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
    cancelByteStream(response.body, error)
    throw error
  }
  // Content-Length bounds encoded wire bytes, which can exceed the decoded
  // model size due to gzip/br framing and incompressible blocks. Give that
  // declaration a separate bounded overhead budget, even when CORS hides
  // Content-Encoding; never use this budget for decoded stream allocation.
  const maxEncodedByteLength = maxByteLength + Math.max(64 * 1024, Math.ceil(maxByteLength / 1024))
  if (declaredByteLength !== null && declaredByteLength > maxEncodedByteLength) {
    cancelByteStream(response.body)
    throw new Error(`下载模型大小校验失败: ${contentLength} > ${maxEncodedByteLength}`)
  }
  if (!response.body) {
    // Response.arrayBuffer() allocates the full payload before its size can be
    // checked, which would bypass the streamed hard cap for synthetic or
    // non-standard bodyless responses.
    throw new Error('下载模型响应正文不可用')
  }
  return readBoundedByteStream(response.body, {
    expectedByteLength,
    maxByteLength: expectedByteLength === null ? maxByteLength : Math.min(expectedByteLength, maxByteLength),
    sizeError: (actual, limit) =>
      isDecoySizedResponse(response, actual, maxByteLength)
        ? new ModelAccessKeyRejectedError()
        : new Error(`下载模型大小校验失败: ${actual} ${expectedByteLength !== null ? '!=' : '>'} ${limit}`),
    wait: deadline.runPromise,
  })
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
    const fetchImpl = resolveFetchImplementation(environment.fetchImpl)
    const response = await fetchModelResponse(deadline, () =>
      fetchImpl(getModelUrl(), createModelFetchInit(deadline.signal, accessKey)),
    )
    if (!response.ok) {
      cancelByteStream(response.body)
      deadline.throwIfExpired()
      if (response.status === 403) {
        throw new ModelAccessKeyRejectedError()
      }
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
    // A tiny declaration can be compression, not a rejected Key. Preserve the
    // decoy classification only when the decoded body is also far too small.
    if (isDecoySizedResponse(response, buffer.byteLength, integrity.byteLength)) {
      throw new ModelAccessKeyRejectedError()
    }
    if (verifyIntegrity) {
      const sha256 = await deadline.run(() => sha256Hex(buffer))
      if (sha256 !== integrity.sha256) {
        throw new ModelIntegrityVerificationError('下载模型 SHA-256 校验失败')
      }
    }
    deadline.throwIfExpired()
    return captureModelDownloadConfirmation(response, buffer, accessKey, fetchImpl)
  } finally {
    deadline.dispose()
  }
}

export type ModelDownloadQuotaStatus = Readonly<{
  enabled: boolean
  limit: number
  used: number
  remaining: number | null
  retryAfterSeconds: number | null
}>

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseQuotaStatus(value: unknown, label: string): ModelDownloadQuotaStatus {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${label}失败: 响应格式无效`)
  }
  const candidate = value as Partial<ModelDownloadQuotaStatus>
  if (typeof candidate.enabled !== 'boolean') {
    throw new Error(`${label}失败: 响应格式无效`)
  }
  if (!candidate.enabled) {
    if (
      candidate.limit !== 0 ||
      candidate.used !== 0 ||
      candidate.remaining !== null ||
      candidate.retryAfterSeconds !== null
    ) {
      throw new Error(`${label}失败: 响应格式无效`)
    }
    return {
      enabled: false,
      limit: 0,
      used: 0,
      remaining: null,
      retryAfterSeconds: null,
    }
  }
  if (
    !isSafeNonNegativeInteger(candidate.limit) ||
    candidate.limit !== MODEL_MONTHLY_DOWNLOAD_LIMIT ||
    !isSafeNonNegativeInteger(candidate.used) ||
    candidate.used > candidate.limit ||
    !isSafeNonNegativeInteger(candidate.remaining) ||
    candidate.remaining !== candidate.limit - candidate.used ||
    !isSafeNonNegativeInteger(candidate.retryAfterSeconds) ||
    candidate.retryAfterSeconds < 1
  ) {
    throw new Error(`${label}失败: 响应格式无效`)
  }
  return {
    enabled: true,
    limit: candidate.limit,
    used: candidate.used,
    remaining: candidate.remaining,
    retryAfterSeconds: candidate.retryAfterSeconds,
  }
}

type ModelAccessOptions = Pick<ModelIntegrityOptions, 'accessKeyOverride'>

async function requestModelDownloadQuota(
  deadline: DownloadDeadline,
  options: ModelAccessOptions,
  environment: ModelDownloadEnvironment,
  label: string,
): Promise<ModelDownloadQuotaStatus> {
  deadline.throwIfExpired()
  const accessKey = await deadline.run(() =>
    getRequestAccessKey(options.accessKeyOverride, environment.getAccessKey, deadline.signal),
  )
  const fetchImpl = resolveFetchImplementation(environment.fetchImpl)
  const response = await fetchModelResponse(deadline, () =>
    fetchImpl(getQuotaUrl(), createModelFetchInit(deadline.signal, accessKey)),
  )
  if (!response.ok) {
    cancelByteStream(response.body)
    deadline.throwIfExpired()
    if (response.status === 403) {
      throw new ModelAccessKeyRejectedError()
    }
    if (response.status === 429) {
      throw new ModelDownloadQuotaExceededError(parseRetryAfterSeconds(response.headers.get('retry-after')))
    }
    throw new Error(`${label}失败: HTTP ${response.status}`)
  }
  const value = await readModelJsonResponse(response, deadline, label)
  deadline.throwIfExpired()
  return parseQuotaStatus(value, label)
}

export async function queryModelDownloadQuota(
  signal?: AbortSignal,
  options: ModelAccessOptions = {},
  environment: ModelDownloadEnvironment = {},
): Promise<ModelDownloadQuotaStatus> {
  const label = '模型下载次数查询'
  const deadline = createDownloadDeadline(signal, label, inferenceTimeoutConfig.modelProbeTimeoutMs)
  try {
    return await requestModelDownloadQuota(deadline, options, environment, label)
  } finally {
    deadline.dispose()
  }
}

export type ModelAccessKeyProbe = Readonly<{
  /** True only after the authenticated quota endpoint returns a valid status. */
  valid: boolean
  /** Set when the Key is valid but its monthly download quota is already spent. */
  quotaExceededRetryAfterSeconds: number | null
}>

/**
 * Validates a Key through authenticated GET /quota without requesting a model,
 * reserving a download receipt, or confirming a download. Exhausted and disabled
 * quotas still authenticate the Key; only HTTP 403 supplies an invalid verdict.
 */
export async function probeModelAccessKey(
  signal?: AbortSignal,
  options: ModelAccessOptions = {},
  environment: ModelDownloadEnvironment = {},
): Promise<ModelAccessKeyProbe> {
  const label = '模型 Key 验证'
  const deadline = createDownloadDeadline(signal, label, inferenceTimeoutConfig.modelProbeTimeoutMs)
  try {
    const quota = await requestModelDownloadQuota(deadline, options, environment, label)
    return {
      valid: true,
      quotaExceededRetryAfterSeconds: quota.enabled && quota.remaining === 0 ? quota.retryAfterSeconds : null,
    }
  } catch (error) {
    deadline.throwIfExpired()
    if (error instanceof ModelAccessKeyRejectedError) {
      return { valid: false, quotaExceededRetryAfterSeconds: null }
    }
    throw error
  } finally {
    deadline.dispose()
  }
}
