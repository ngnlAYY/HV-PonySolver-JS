import { DEFAULT_PUBLIC_MODEL_PATH } from '@hv-pony-solver/shared'
import type { Env, InvalidKeyMode, NormalizedEnv } from './worker-types'

function normalizeInvalidKeyMode(value: string | undefined): InvalidKeyMode {
  const mode = value?.trim().toLowerCase()
  if (mode === undefined || mode === '' || mode === 'decoy') {
    return 'decoy'
  }
  if (mode === 'error') {
    return 'error'
  }
  throw new Error('INVALID_KEY_MODE must be one of: decoy, error')
}

function requireText(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`${name} is not configured`)
  }
  return value
}

function requireBinding<T>(value: T | undefined, name: string): T {
  if (!value || typeof (value as { get?: unknown }).get !== 'function') {
    throw new Error(`${name} binding is not configured`)
  }
  return value
}

export function normalizeEnv(env: Env): NormalizedEnv {
  return {
    modelKeys: requireBinding(env.MODEL_KEYS, 'MODEL_KEYS'),
    modelBucket: requireBinding(env.MODEL_BUCKET, 'MODEL_BUCKET'),
    publicModelPath: env.PUBLIC_MODEL_PATH ?? DEFAULT_PUBLIC_MODEL_PATH,
    realModelObjectKey: requireText(env.REAL_MODEL_OBJECT_KEY, 'REAL_MODEL_OBJECT_KEY'),
    decoyModelObjectKey: requireText(env.DECOY_MODEL_OBJECT_KEY, 'DECOY_MODEL_OBJECT_KEY'),
    invalidKeyMode: normalizeInvalidKeyMode(env.INVALID_KEY_MODE),
  }
}
