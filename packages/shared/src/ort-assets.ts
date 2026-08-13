import { ORT_MODEL_FILENAME } from './ort-model'
import { ORT_RUNTIME_WASM_FILENAME } from './ort-runtime'

export * from './ort-model'
export * from './ort-runtime'

export const ORT_MODEL_PUBLIC_PATH = `/${ORT_MODEL_FILENAME}`
export const ORT_MODEL_URL = `https://models.ngnl.host${ORT_MODEL_PUBLIC_PATH}`
export const ORT_MODEL_OBJECT_KEY = `real/${ORT_MODEL_FILENAME}`
export const ORT_RUNTIME_WASM_PUBLIC_PATH = `/runtime/${ORT_RUNTIME_WASM_FILENAME}`
export const ORT_RUNTIME_WASM_URL = `https://models.ngnl.host${ORT_RUNTIME_WASM_PUBLIC_PATH}`
export const ORT_RUNTIME_WASM_OBJECT_KEY = `runtime/${ORT_RUNTIME_WASM_FILENAME}`
