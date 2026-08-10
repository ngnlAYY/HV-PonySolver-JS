import {
  ORT_MODEL_OBJECT_KEY,
  ORT_MODEL_PUBLIC_PATH,
  ORT_RUNTIME_WASM_OBJECT_KEY,
  ORT_RUNTIME_WASM_PUBLIC_PATH,
} from '@hv-pony-solver/shared'

import type { Env, InvalidKeyMode, WorkerConfig } from './worker-types'

const LEGACY_MODEL_PUBLIC_PATH = '/yolo26n-640.onnx'

function readRequiredValue(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new Error(`${name} is required`)
  }
  return normalized
}

function readPath(value: string | undefined, fallback: string, name: string): string {
  const normalized = value?.trim() || fallback
  if (!normalized.startsWith('/') || normalized.includes('?') || normalized.includes('#')) {
    throw new Error(`${name} must be an absolute pathname`)
  }
  return normalized
}

function readInvalidKeyMode(value: string | undefined): InvalidKeyMode {
  const normalized = value?.trim().toLowerCase() || 'decoy'
  if (normalized !== 'decoy' && normalized !== 'error') {
    throw new Error('INVALID_KEY_MODE must be one of: decoy, error')
  }
  return normalized
}

export function readWorkerConfig(env: Env): WorkerConfig {
  return {
    publicModelPath: readPath(env.PUBLIC_MODEL_PATH, LEGACY_MODEL_PUBLIC_PATH, 'PUBLIC_MODEL_PATH'),
    publicOrtModelPath: readPath(env.PUBLIC_ORT_MODEL_PATH, ORT_MODEL_PUBLIC_PATH, 'PUBLIC_ORT_MODEL_PATH'),
    publicRuntimeWasmPath: readPath(
      env.PUBLIC_RUNTIME_WASM_PATH,
      ORT_RUNTIME_WASM_PUBLIC_PATH,
      'PUBLIC_RUNTIME_WASM_PATH',
    ),
    realModelObjectKey: readRequiredValue(env.REAL_MODEL_OBJECT_KEY, 'REAL_MODEL_OBJECT_KEY'),
    realOrtModelObjectKey: env.REAL_ORT_MODEL_OBJECT_KEY?.trim() || ORT_MODEL_OBJECT_KEY,
    decoyModelObjectKey: readRequiredValue(env.DECOY_MODEL_OBJECT_KEY, 'DECOY_MODEL_OBJECT_KEY'),
    runtimeWasmObjectKey: env.RUNTIME_WASM_OBJECT_KEY?.trim() || ORT_RUNTIME_WASM_OBJECT_KEY,
    invalidKeyMode: readInvalidKeyMode(env.INVALID_KEY_MODE),
  }
}
