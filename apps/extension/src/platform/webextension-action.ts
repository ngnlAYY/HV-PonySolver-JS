import { resolveRawExtensionApi } from './webextension-api'

export function registerOpenOptionsAction(): () => void {
  const { api, promiseStyle } = resolveRawExtensionApi()
  const listener = (): void => {
    if (promiseStyle) {
      void api.runtime.openOptionsPage()
      return
    }
    api.runtime.openOptionsPage(() => undefined)
  }
  api.action.onClicked.addListener(listener)
  return () => api.action.onClicked.removeListener(listener)
}
