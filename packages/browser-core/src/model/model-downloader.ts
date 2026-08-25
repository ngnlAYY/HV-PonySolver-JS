import { inferenceTimeoutConfig } from '../inference/inference-config'
import { raceAbort } from '../utils/abort-race'
import { ModelAccessKeyRejectedError, ModelDownloadQuotaExceededError } from './model-download-error'
import { modelConfig } from './model-config'
import { computeModelSha256, type ModelIntegrityOptions, resolveIntegrityOptions } from './model-integrity'
import { ModelIntegrityVerificationError } from './permanent-model-error'

export type { ModelIntegrityOptions } from './model-integrity'

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
  const init: RequestInit = { cache: 'no-store', signal }
  if (accessKey) {
    init.headers = { authorization: `Bearer ${accessKey}` }
  }
  return init
}

function createModelProbeInit(signal: AbortSignal, accessKey: string): RequestInit {
  return { ...createModelFetchInit(signal, accessKey), method: 'HEAD' }
}

function parseProbeByteLength(contentLength: string | null): number {
  if (contentLength === null || !contentLengthPattern.test(contentLength)) {
    throw new Error('模型 Key 验证失败: 响应缺少有效的 Content-Length')
  }
  const byteLength = Number(contentLength)
  if (!Number.isSafeInteger(byteLength)) {
    throw new Error('模型 Key 验证失败: 响应缺少有效的 Content-Length')
  }
  return byteLength
}

const contentLengthPattern = /^[0-9]+$/

/**
 * Marks Content-Length declarations that brand an unauthorized Key's decoy.
 *
 * The decoy is orders of magnitude smaller than the real model, so a success
 * response declaring such a tiny body is untrustworthy: it may be a rejected
 * Key, or a proxy misreporting a real payload. The declaration therefore only
 * flags suspicion — the body hash decides — and must not drive read bounds.
 */
function isSuspiciousDeclaredLength(contentLength: string | null, expectedByteLength: number): boolean {
  if (contentLength === null || !contentLengthPattern.test(contentLength)) {
    return false
  }
  const declaredByteLength = Number(contentLength)
  return Number.isSafeInteger(declaredByteLength) && declaredByteLength * 2 < expectedByteLength
}

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
  // A suspicious declaration may be lying about the payload, so it must not
  // drive the read bounds; the caller adjudicates the body by hash instead.
  const suspiciousDeclared =
    declaredByteLength !== null && isSuspiciousDeclaredLength(contentLength, expectedByteLength ?? maxByteLength)
  const trustDeclared = declaredByteLength !== null && !suspiciousDeclared
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
    if (trustDeclared) {
      assertDeclaredByteLength(buffer.byteLength, declaredByteLength)
    }
    assertModelByteLength(buffer, expectedByteLength, maxByteLength)
    return buffer
  }
  // Suspicious declarations collect into chunks instead of a pre-sized buffer:
  // their length claim is unproven until the caller's hash check passes.
  const expectedContentLength =
    declaredByteLength === null ? expectedByteLength : trustDeclared ? declaredByteLength : null
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
    // The Worker answers an unauthorized Key with a small decoy under HTTP 200,
    // but a lying proxy can declare the same tiny length for the real payload.
    // A suspicious declaration therefore only triggers suspicion: the body hash
    // proves a real model, and only a mismatch names the decoy as permanent.
    const suspicious = isSuspiciousDeclaredLength(response.headers.get('content-length'), integrity.byteLength)
    if (verifyIntegrity || suspicious) {
      if (buffer.byteLength !== integrity.byteLength && !suspicious) {
        throw new Error(`下载模型大小校验失败: ${buffer.byteLength} != ${integrity.byteLength}`)
      }
      const sha256 = await deadline.run(() => computeModelSha256(buffer))
      if (sha256 === integrity.sha256) {
        deadline.throwIfExpired()
        return buffer
      }
    }
    deadline.throwIfExpired()
    if (suspicious) {
      throw new ModelAccessKeyRejectedError()
    }
    if (verifyIntegrity) {
      throw new ModelIntegrityVerificationError(`下载模型 SHA-256 校验失败`)
    }
    return buffer
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

function parseQuotaStatus(value: unknown): ModelDownloadQuotaStatus {
  if (typeof value !== 'object' || value === null) {
    throw new Error('模型下载次数查询失败: 响应格式无效')
  }
  const candidate = value as Partial<ModelDownloadQuotaStatus>
  if (typeof candidate.enabled !== 'boolean') {
    throw new Error('模型下载次数查询失败: 响应格式无效')
  }
  if (!candidate.enabled) {
    if (
      candidate.limit !== 0 ||
      candidate.used !== 0 ||
      candidate.remaining !== null ||
      candidate.retryAfterSeconds !== null
    ) {
      throw new Error('模型下载次数查询失败: 响应格式无效')
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
    candidate.limit < 1 ||
    !isSafeNonNegativeInteger(candidate.used) ||
    candidate.used > candidate.limit ||
    !isSafeNonNegativeInteger(candidate.remaining) ||
    candidate.remaining !== candidate.limit - candidate.used ||
    !isSafeNonNegativeInteger(candidate.retryAfterSeconds) ||
    candidate.retryAfterSeconds < 1
  ) {
    throw new Error('模型下载次数查询失败: 响应格式无效')
  }
  return {
    enabled: true,
    limit: candidate.limit,
    used: candidate.used,
    remaining: candidate.remaining,
    retryAfterSeconds: candidate.retryAfterSeconds,
  }
}

export async function queryModelDownloadQuota(
  signal?: AbortSignal,
  options: ModelIntegrityOptions = {},
  environment: ModelDownloadEnvironment = {},
): Promise<ModelDownloadQuotaStatus> {
  const deadline = createDownloadDeadline(signal, '模型下载次数查询', inferenceTimeoutConfig.modelProbeTimeoutMs)
  try {
    deadline.throwIfExpired()
    const accessKey = await deadline.run(() =>
      getRequestAccessKey(options.accessKeyOverride, environment.getAccessKey, deadline.signal),
    )
    const response = await deadline.run(() =>
      (environment.fetchImpl ?? fetch)(getQuotaUrl(), createModelFetchInit(deadline.signal, accessKey)),
    )
    if (!response.ok) {
      await cancelResponseBody(response, deadline)
      deadline.throwIfExpired()
      if (response.status === 403) {
        throw new ModelAccessKeyRejectedError()
      }
      if (response.status === 429) {
        throw new ModelDownloadQuotaExceededError(parseRetryAfterSeconds(response.headers.get('retry-after')))
      }
      throw new Error(`模型下载次数查询失败: HTTP ${response.status}`)
    }
    const value: unknown = await deadline.run(() => response.json())
    deadline.throwIfExpired()
    return parseQuotaStatus(value)
  } finally {
    deadline.dispose()
  }
}

export type ModelAccessKeyProbe = Readonly<{
  /** True when the Worker served the real model rather than the decoy. */
  valid: boolean
  /** Set when the Key is valid but its monthly download quota is already spent. */
  quotaExceededRetryAfterSeconds: number | null
}>

/**
 * Checks whether an access Key unlocks the real model without spending a download.
 *
 * The Worker only meters GET requests, so a HEAD probe leaves the monthly quota
 * untouched. A valid Key is served the real object and reports its full byte
 * length; an invalid one silently receives the much smaller decoy.
 */
export async function probeModelAccessKey(
  signal?: AbortSignal,
  options: ModelIntegrityOptions = {},
  environment: ModelDownloadEnvironment = {},
): Promise<ModelAccessKeyProbe> {
  const { integrity } = resolveIntegrityOptions(options)
  const deadline = createDownloadDeadline(signal, '模型 Key 验证', inferenceTimeoutConfig.modelProbeTimeoutMs)
  try {
    deadline.throwIfExpired()
    const accessKey = await deadline.run(() =>
      getRequestAccessKey(options.accessKeyOverride, environment.getAccessKey, deadline.signal),
    )
    const response = await deadline.run(() =>
      (environment.fetchImpl ?? fetch)(getModelUrl(), createModelProbeInit(deadline.signal, accessKey)),
    )
    await cancelResponseBody(response, deadline)
    deadline.throwIfExpired()
    // Defensive: the Worker only meters GET, so a HEAD probe is never rejected
    // for quota today. Should that contract change, an exhausted quota still
    // proves the Key itself is good.
    if (response.status === 429) {
      return {
        valid: true,
        quotaExceededRetryAfterSeconds: parseRetryAfterSeconds(response.headers.get('retry-after')),
      }
    }
    if (response.status === 403) {
      return { valid: false, quotaExceededRetryAfterSeconds: null }
    }
    if (!response.ok) {
      throw new Error(`模型 Key 验证失败: HTTP ${response.status}`)
    }
    const declaredByteLength = parseProbeByteLength(response.headers.get('content-length'))
    return {
      valid: declaredByteLength === integrity.byteLength,
      quotaExceededRetryAfterSeconds: null,
    }
  } finally {
    deadline.dispose()
  }
}
