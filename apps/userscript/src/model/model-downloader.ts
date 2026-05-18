import { modelConfig } from './model-config'

function getModelUrl(): string {
  if (!modelConfig.urlBase) {
    throw new Error('模型下载地址未配置')
  }
  return `${modelConfig.urlBase}?key=${encodeURIComponent(modelConfig.accessKey)}`
}

export async function downloadModel(): Promise<ArrayBuffer> {
  const response = await fetch(getModelUrl(), { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`模型下载失败: HTTP ${response.status}`)
  }
  return response.arrayBuffer()
}
