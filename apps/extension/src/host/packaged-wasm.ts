import { ORT_RUNTIME_WASM_FILENAME, ORT_RUNTIME_WASM_INTEGRITY } from '@hv-pony-solver/shared/ort-runtime'

import { loadPackagedAsset } from './packaged-asset'

export async function loadPackagedRuntimeWasm(fetchImpl: typeof fetch = fetch): Promise<ArrayBuffer> {
  return loadPackagedAsset(
    new URL(`runtime/${ORT_RUNTIME_WASM_FILENAME}`, globalThis.location.href).href,
    ORT_RUNTIME_WASM_INTEGRITY,
    '扩展 ONNX Runtime WASM',
    fetchImpl,
  )
}
