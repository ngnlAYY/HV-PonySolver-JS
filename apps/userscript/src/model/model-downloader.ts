import { inferenceTimeoutConfig } from '../inference/inference-config'
import { modelConfig } from './model-config'
import type { ModelIntegrity } from './model-integrity'
import { verifyModelIntegrity } from './model-integrity'
import { getModelAccessKey } from './model-settings'

export type ModelIntegrityOptions = Readonly<{
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

async function getModelUrl(): Promise<string> {
  if (!modelConfig.urlBase) {
    throw new Error('模型下载地址未配置')
  }
  let storedAccessKey = ''
  try {
    storedAccessKey = await getModelAccessKey()
  } catch {
    storedAccessKey = ''
  }
  const accessKey = storedAccessKey || modelConfig.accessKey
  return `${modelConfig.urlBase}?key=${encodeURIComponent(accessKey)}`
}

async function readModelResponse(
  response: Response,
  expectedByteLength: number | null,
  maxByteLength: number,
): Promise<ArrayBuffer> {
  const contentLength = response.headers.get('content-length')
  if (expectedByteLength !== null && contentLength && Number(contentLength) > expectedByteLength) {
    await response.body?.cancel()
    throw new Error(`下载模型大小校验失败: ${contentLength} != ${expectedByteLength}`)
  }
  if (contentLength && Number(contentLength) > maxByteLength) {
    await response.body?.cancel()
    throw new Error(`下载模型大小校验失败: ${contentLength} > ${maxByteLength}`)
  }
  if (!response.body) {
    return response.arrayBuffer()
  }
  const expectedContentLength =
    expectedByteLength !== null && contentLength === String(expectedByteLength) ? expectedByteLength : null
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
    const response = await fetch(await getModelUrl(), { cache: 'no-store', signal: controller.signal })
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
