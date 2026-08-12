import {
  downloadModel as downloadCoreModel,
  type ModelIntegrityOptions,
} from '@hv-pony-solver/browser-core'

import { getModelAccessKey } from './model-settings'

export type { ModelDownloadEnvironment, ModelIntegrityOptions } from '@hv-pony-solver/browser-core'

export function downloadModel(signal?: AbortSignal, options: ModelIntegrityOptions = {}): Promise<ArrayBuffer> {
  return downloadCoreModel(signal, options, { getAccessKey: getModelAccessKey })
}
