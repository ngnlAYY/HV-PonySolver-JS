import { ORT_RUNTIME_WASM_FILENAME, ORT_RUNTIME_WASM_INTEGRITY } from '@hv-pony-solver/shared/ort-runtime'

import { loadPackagedAsset } from './packaged-asset'

export async function loadPackagedRuntimeWasm(fetchImpl?: typeof fetch): Promise<ArrayBuffer> {
  return loadPackagedAsset(
    // The inference Worker and WASM are siblings in the package's runtime directory.
    new URL(ORT_RUNTIME_WASM_FILENAME, globalThis.location.href).href,
    ORT_RUNTIME_WASM_INTEGRITY,
    '扩展 ONNX Runtime WASM',
    fetchImpl,
  )
}
