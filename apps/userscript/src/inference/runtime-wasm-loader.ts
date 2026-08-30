import { loadVerifiedRuntimeAsset, type VerifiedRuntimeAsset } from './verified-runtime-asset-loader'

type RuntimeWasmAsset = VerifiedRuntimeAsset

declare const __HV_PONY_SOLVER_BUNDLED_ORT_WASM_URL__: string
declare const __HV_PONY_SOLVER_BUNDLED_ORT_WASM_BYTE_LENGTH__: number
declare const __HV_PONY_SOLVER_BUNDLED_ORT_WASM_SHA256__: string
declare const __HV_PONY_SOLVER_BUNDLED_ORT_WASM_MAX_BYTE_LENGTH__: number

function configuredRuntimeWasmAsset(): RuntimeWasmAsset {
  return {
    url: __HV_PONY_SOLVER_BUNDLED_ORT_WASM_URL__,
    byteLength: __HV_PONY_SOLVER_BUNDLED_ORT_WASM_BYTE_LENGTH__,
    sha256: __HV_PONY_SOLVER_BUNDLED_ORT_WASM_SHA256__,
    maxByteLength: __HV_PONY_SOLVER_BUNDLED_ORT_WASM_MAX_BYTE_LENGTH__,
  }
}

export async function loadVerifiedRuntimeWasm(
  fetchImpl: typeof fetch | undefined = undefined,
  expected: RuntimeWasmAsset = configuredRuntimeWasmAsset(),
): Promise<ArrayBuffer> {
  return loadVerifiedRuntimeAsset('ONNX Runtime WASM', expected, fetchImpl)
}
