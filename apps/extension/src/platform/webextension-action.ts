import { formatErrorMessage } from '@hv-pony-solver/browser-core/utils/errors'
import { warn } from '@hv-pony-solver/browser-core/utils/logger'

import { callbackError, resolveRawExtensionApi } from './webextension-api'

export function registerOpenOptionsAction(): () => void {
  const { api, promiseStyle } = resolveRawExtensionApi()
  const listener = (): void => {
    if (promiseStyle) {
      void Promise.resolve(api.runtime.openOptionsPage()).catch((error: unknown) => {
        warn('打开设置页失败:', formatErrorMessage(error))
      })
      return
    }
    api.runtime.openOptionsPage(() => {
      const error = callbackError(api.runtime)
      if (error) {
        warn('打开设置页失败:', formatErrorMessage(error))
      }
    })
  }
  api.action.onClicked.addListener(listener)
  return () => api.action.onClicked.removeListener(listener)
}
