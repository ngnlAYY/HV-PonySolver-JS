import { resolveRawExtensionApi } from './webextension-api'

export type ChromiumOffscreenApi = Readonly<{
  getContexts(filter: Readonly<{ contextTypes: string[]; documentUrls: string[] }>): Promise<unknown[]>
  createDocument(options: Readonly<{ url: string; reasons: string[]; justification: string }>): Promise<void>
}>

export function getChromiumOffscreenApi(): ChromiumOffscreenApi {
  const { api } = resolveRawExtensionApi()
  if (!api.runtime.getContexts || !api.offscreen) {
    throw new Error('当前 Chromium 不支持 Offscreen Document')
  }
  return {
    getContexts: (filter) => api.runtime.getContexts!(filter),
    createDocument: (options) => api.offscreen!.createDocument(options),
  }
}
