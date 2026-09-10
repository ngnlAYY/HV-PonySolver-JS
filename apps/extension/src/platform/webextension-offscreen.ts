import { resolveRawExtensionApi } from './webextension-api'

export type ChromiumOffscreenApi = Readonly<{
  getContexts(filter: Readonly<{ contextTypes: string[]; documentUrls: string[] }>): Promise<unknown[]>
  createDocument(options: Readonly<{ url: string; reasons: string[]; justification: string }>): Promise<void>
  closeDocument(): Promise<void>
}>

export function getChromiumOffscreenApi(): ChromiumOffscreenApi {
  const { api } = resolveRawExtensionApi()
  const getContexts = api.runtime.getContexts
  const offscreen = api.offscreen
  if (!getContexts || !offscreen) {
    throw new Error('当前 Chromium 不支持 Offscreen Document')
  }
  return {
    getContexts: (filter) => getContexts.call(api.runtime, filter),
    createDocument: (options) => offscreen.createDocument(options),
    closeDocument: () => offscreen.closeDocument(),
  }
}
