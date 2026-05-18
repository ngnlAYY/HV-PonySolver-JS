export interface ModelKeyStore {
  get(key: string): Promise<string | null>
}

export interface ModelBucket {
  get(key: string): Promise<R2ObjectBody | null>
}

export type InvalidKeyMode = 'decoy' | 'error'

export interface Env {
  MODEL_KEYS: ModelKeyStore
  MODEL_BUCKET: ModelBucket
  PUBLIC_MODEL_PATH?: string
  REAL_MODEL_OBJECT_KEY: string
  DECOY_MODEL_OBJECT_KEY: string
  INVALID_KEY_MODE?: string
}

export interface NormalizedEnv {
  modelKeys: ModelKeyStore
  modelBucket: ModelBucket
  publicModelPath: string
  realModelObjectKey: string
  decoyModelObjectKey: string
  invalidKeyMode: InvalidKeyMode
}
