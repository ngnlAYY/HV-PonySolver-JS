import { inferenceTimeoutConfig } from '../inference/inference-config'
import { modelConfig } from './model-config'
import type { ModelIntegrity } from './model-integrity'
import { verifyModelIntegrity } from './model-integrity'
import { getModelAccessKey } from './model-settings'

export type ModelIntegrityOptions = Readonly<{
  accessKeyOverride?: string
  integrity?: ModelIntegrity
  verifyIntegrity?: boolean
  forceVerifyIntegrity?: boolean
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

async function getRequestAccessKey(accessKeyOverride?: string): Promise<string> {
  const candidateAccessKey = accessKeyOverride?.trim()
  if (candidateAccessKey) {
    return candidateAccessKey
  }
  let storedAccessKey: string
  try {
    storedAccessKey = await getModelAccessKey()
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
    await response.body?.cancel()
    throw error
  }
  if (expectedByteLength !== null && declaredByteLength !== null && declaredByteLength > expectedByteLength) {
    await response.body?.cancel()
    throw new Error(`下载模型大小校验失败: ${contentLength} != ${expectedByteLength}`)
  }
  if (declaredByteLength !== null && declaredByteLength > maxByteLength) {
    await response.body?.cancel()
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
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    const nextTotalBytes = totalBytes + value.byteLength
    if (expectedContentLength !== null && nextTotalBytes > expectedContentLength) {
      await reader.cancel()
      throw new Error(`下载模型大小校验失败: ${nextTotalBytes} != ${expectedContentLength}`)
    }
    if (expectedByteLength !== null && nextTotalBytes > expectedByteLength) {
      await reader.cancel()
      throw new Error(`下载模型大小校验失败: ${nextTotalBytes} != ${expectedByteLength}`)
    }
    if (nextTotalBytes > maxByteLength) {
      await reader.cancel()
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
}

export async function downloadModel(signal?: AbortSignal, options: ModelIntegrityOptions = {}): Promise<ArrayBuffer> {
  const { integrity, verifyIntegrity } = resolveIntegrityOptions(options)
  if (signal?.aborted) {
    throw new Error('模型下载已取消')
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), inferenceTimeoutConfig.modelDownloadTimeoutMs)
  const abort = (): void => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const accessKey = await getRequestAccessKey(options.accessKeyOverride)
    const response = await fetch(getModelUrl(), createModelFetchInit(controller.signal, accessKey))
    if (!response.ok) {
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
