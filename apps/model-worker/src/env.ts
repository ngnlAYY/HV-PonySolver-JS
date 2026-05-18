import { DEFAULT_PUBLIC_MODEL_PATH } from '@hv-pony-solver/shared'
import type { Env, InvalidKeyMode, NormalizedEnv } from './worker-types'

function normalizeInvalidKeyMode(value: string | undefined): InvalidKeyMode {
  return value === 'error' ? 'error' : 'decoy'
}

function requireText(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is not configured`)
  }
  return value
}

export function normalizeEnv(env: Env): NormalizedEnv {
  return {
    modelKeys: env.MODEL_KEYS,
    modelBucket: env.MODEL_BUCKET,
    publicModelPath: env.PUBLIC_MODEL_PATH ?? DEFAULT_PUBLIC_MODEL_PATH,
    realModelObjectKey: requireText(env.REAL_MODEL_OBJECT_KEY, 'REAL_MODEL_OBJECT_KEY'),
    decoyModelObjectKey: requireText(env.DECOY_MODEL_OBJECT_KEY, 'DECOY_MODEL_OBJECT_KEY'),
    invalidKeyMode: normalizeInvalidKeyMode(env.INVALID_KEY_MODE),
  }
}
