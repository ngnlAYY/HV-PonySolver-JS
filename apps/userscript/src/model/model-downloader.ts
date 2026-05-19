import { inferenceConfig } from '../inference/inference-config'
import { modelConfig } from './model-config'

function getModelUrl(): string {
  if (!modelConfig.urlBase) {
    throw new Error('模型下载地址未配置')
  }
  return `${modelConfig.urlBase}?key=${encodeURIComponent(modelConfig.accessKey)}`
}

export async function downloadModel(signal?: AbortSignal): Promise<ArrayBuffer> {
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
    const buffer = await response.arrayBuffer()
    return buffer
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', abort)
  }
}
