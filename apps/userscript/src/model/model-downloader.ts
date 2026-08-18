import { downloadModel as downloadCoreModel, type ModelIntegrityOptions } from '@hv-pony-solver/browser-core'

import { getModelAccessKey } from './model-settings'

export type { ModelDownloadEnvironment, ModelIntegrityOptions } from '@hv-pony-solver/browser-core'

export function downloadModel(signal?: AbortSignal, options: ModelIntegrityOptions = {}): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    return Promise.reject(new Error('模型下载已取消'))
  }

  return downloadCoreModel(undefined, options, {
    fetchImpl: (input, init) => {
      const deadlineSignal = init?.signal
      const combinedSignal =
        signal && deadlineSignal ? AbortSignal.any([signal, deadlineSignal]) : (signal ?? deadlineSignal)
      return combinedSignal ? fetch(input, { ...init, signal: combinedSignal }) : fetch(input, init)
    },
    getAccessKey: async () => {
      try {
        return await getModelAccessKey()
      } catch {
        return ''
      }
    },
  })
}
