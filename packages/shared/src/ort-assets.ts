export const ORT_MODEL_FILENAME = 'yolo26n-640.ort'
export const ORT_MODEL_PUBLIC_PATH = `/${ORT_MODEL_FILENAME}`
export const ORT_MODEL_URL = `https://models.ngnl.host${ORT_MODEL_PUBLIC_PATH}`
export const ORT_MODEL_OBJECT_KEY = ORT_MODEL_FILENAME
export const ORT_MODEL_INTEGRITY = {
  byteLength: 9_914_448,
  sha256: '4e771776d9356679539ffed53ee40ea012394f9b586aa92a76267e8fee38094c',
} as const

export const ORT_RUNTIME_VERSION = '1.27.0'
export const ORT_RUNTIME_SOURCE_COMMIT = '8f0278c77bf44b0cc83c098c6c722b92a36ac4b5'
export const ORT_RUNTIME_WASM_SHA256 = '25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa'
export const ORT_RUNTIME_WASM_FILENAME = `ort-wasm-simd-${ORT_RUNTIME_WASM_SHA256}.wasm`
export const ORT_RUNTIME_WASM_PUBLIC_PATH = `/runtime/${ORT_RUNTIME_WASM_FILENAME}`
export const ORT_RUNTIME_WASM_URL = `https://models.ngnl.host${ORT_RUNTIME_WASM_PUBLIC_PATH}`
export const ORT_RUNTIME_WASM_OBJECT_KEY = `runtime/${ORT_RUNTIME_WASM_FILENAME}`
export const ORT_RUNTIME_WASM_INTEGRITY = {
  byteLength: 1_267_937,
  sha256: ORT_RUNTIME_WASM_SHA256,
} as const
