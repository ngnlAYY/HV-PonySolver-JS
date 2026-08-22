import { runtimeGetUrl } from '../platform/webextension'
import { loadPackagedAsset } from './packaged-asset'
import { PACKAGED_MODEL_FILENAME, PACKAGED_MODEL_INTEGRITY } from './packaged-model-identity'

export function loadPackagedModel(fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<ArrayBuffer> {
  return loadPackagedAsset(
    runtimeGetUrl(`model/${PACKAGED_MODEL_FILENAME}`),
    PACKAGED_MODEL_INTEGRITY,
    '扩展内置模型',
    fetchImpl,
    signal,
  )
}
