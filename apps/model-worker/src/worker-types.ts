export interface ModelKeyStore {
  get(key: string): Promise<string | null>
}

export interface ModelBucket {
  get(key: string): Promise<R2ObjectBody | null>
  head(key: string): Promise<R2Object | null>
}

export interface Env {
  MODEL_KEYS: ModelKeyStore
  MODEL_BUCKET: ModelBucket
  PUBLIC_MODEL_PATH?: string
  REAL_MODEL_OBJECT_KEY: string
  DECOY_MODEL_OBJECT_KEY: string
  PUBLIC_ORT_MODEL_PATH?: string
  REAL_ORT_MODEL_OBJECT_KEY?: string
  PUBLIC_RUNTIME_WASM_PATH?: string
  RUNTIME_WASM_OBJECT_KEY?: string
  INVALID_KEY_MODE?: string
}

export type InvalidKeyMode = 'decoy' | 'error'

export interface WorkerConfig {
  publicModelPath: string
  publicOrtModelPath: string
  publicRuntimeWasmPath: string
  realModelObjectKey: string
  realOrtModelObjectKey: string
  decoyModelObjectKey: string
  runtimeWasmObjectKey: string
  invalidKeyMode: InvalidKeyMode
}
