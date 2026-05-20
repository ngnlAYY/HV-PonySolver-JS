import { inferenceConfig } from '../inference/inference-config'
import { modelConfig } from './model-config'
import type { ModelIntegrity } from './model-integrity'
import { verifyModelIntegrity } from './model-integrity'

function getModelUrl(): string {
  if (!modelConfig.urlBase) {
    throw new Error('模型下载地址未配置')
  }
  return `${modelConfig.urlBase}?key=${encodeURIComponent(modelConfig.accessKey)}`
}

async function readModelResponse(response: Response, expectedByteLength: number | null): Promise<ArrayBuffer> {
  const contentLength = response.headers.get('content-length')
  if (expectedByteLength !== null && contentLength && Number(contentLength) > expectedByteLength) {
    await response.body?.cancel()
    throw new Error(`下载模型大小校验失败: ${contentLength} != ${expectedByteLength}`)
  }
  if (!response.body) {
    return response.arrayBuffer()
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    totalBytes += value.byteLength
    if (expectedByteLength !== null && totalBytes > expectedByteLength) {
      await reader.cancel()
      throw new Error(`下载模型大小校验失败: ${totalBytes} != ${expectedByteLength}`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

export async function downloadModel(signal?: AbortSignal, integrity: ModelIntegrity = modelConfig.integrity, verifyIntegrity: boolean = modelConfig.verifyIntegrity): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    throw new Error('模型下载已取消')
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), inferenceConfig.modelDownloadTimeoutMs)
  const abort = (): void => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(getModelUrl(), { cache: 'no-store', signal: controller.signal })
    if (!response.ok) {
      throw new Error(`模型下载失败: HTTP ${response.status}`)
    }
    const buffer = await readModelResponse(response, verifyIntegrity ? integrity.byteLength : null)
    if (verifyIntegrity) {
      await verifyModelIntegrity(buffer, integrity, '下载模型')
    }
    return buffer
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abort)
  }
}
