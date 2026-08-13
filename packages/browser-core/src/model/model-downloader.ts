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
  getAccessKey?: () => Promise<string>
}>

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
  getAccessKey: (() => Promise<string>) | undefined,
): Promise<string> {
  const candidateAccessKey = accessKeyOverride?.trim()
  if (candidateAccessKey) {
    return candidateAccessKey
  }
  let storedAccessKey: string
  try {
    storedAccessKey = getAccessKey ? await getAccessKey() : ''
  } catch {
    storedAccessKey = ''
  }
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

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The quota error remains authoritative even if the short error body cannot be cancelled.
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
): Promise<ArrayBuffer> {
  const contentLength = response.headers.get('content-length')
  let declaredByteLength: number | null
  try {
    declaredByteLength = parseDeclaredByteLength(contentLength)
  } catch (error) {
    await cancelResponseBody(response)
    throw error
  }
  if (expectedByteLength !== null && declaredByteLength !== null && declaredByteLength > expectedByteLength) {
    await cancelResponseBody(response)
    throw new Error(`下载模型大小校验失败: ${contentLength} != ${expectedByteLength}`)
  }
  if (declaredByteLength !== null && declaredByteLength > maxByteLength) {
    await cancelResponseBody(response)
    throw new Error(`下载模型大小校验失败: ${contentLength} > ${maxByteLength}`)
  }
  if (!response.body) {
    const buffer = await response.arrayBuffer()
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
      const { done, value } = await reader.read()
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
      await reader.cancel()
    } catch {
      // Preserve the read/validation error.
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
  if (signal?.aborted) {
    throw new Error('模型下载已取消')
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), inferenceTimeoutConfig.modelDownloadTimeoutMs)
  const abort = (): void => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const accessKey = await getRequestAccessKey(options.accessKeyOverride, environment.getAccessKey)
    const response = await (environment.fetchImpl ?? fetch)(
      getModelUrl(),
      createModelFetchInit(controller.signal, accessKey),
    )
    if (!response.ok) {
      await cancelResponseBody(response)
      if (response.status === 429) {
        throw new ModelDownloadQuotaExceededError(parseRetryAfterSeconds(response.headers.get('retry-after')))
      }
      throw new Error(`模型下载失败: HTTP ${response.status}`)
    }
    const buffer = await readModelResponse(
      response,
      verifyIntegrity ? integrity.byteLength : null,
      integrity.byteLength,
    )
    if (verifyIntegrity) {
      await verifyModelIntegrity(buffer, integrity, '下载模型')
    }
    return buffer
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abort)
  }
}
