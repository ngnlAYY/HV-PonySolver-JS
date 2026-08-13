import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'

import { runtimeGetUrl } from '../platform/webextension'
import { loadPackagedAsset } from './packaged-asset'

export function loadPackagedModel(fetchImpl: typeof fetch = fetch): Promise<ArrayBuffer> {
  return loadPackagedAsset(
    runtimeGetUrl(`model/${ORT_MODEL_FILENAME}`),
    ORT_MODEL_INTEGRITY,
    '扩展内置模型',
    fetchImpl,
  )
}
