import {
  ORT_MODEL_OBJECT_KEY,
  ORT_MODEL_PUBLIC_PATH,
  ORT_RUNTIME_WASM_OBJECT_KEY,
  ORT_RUNTIME_WASM_PUBLIC_PATH,
} from '@hv-pony-solver/shared'

import type { Env, InvalidKeyMode, WorkerConfig } from './worker-types'

const LEGACY_MODEL_PUBLIC_PATH = '/yolo26n-640.onnx'
// eslint-disable-next-line no-control-regex -- These code points are the validation target.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
// Paths flow verbatim into the Content-Disposition quoted-string emitted by model-response.ts,
// so quote-like characters are rejected for parity with scripts/wrangler-guard's TOML string rule.
const FORBIDDEN_PATH_CHARACTER_PATTERN = /["'`]/
const PATH_MUST_BE_ABSOLUTE_MESSAGE = 'must be an absolute pathname'
const PATH_MUST_NOT_CONTAIN_QUOTES_MESSAGE = 'must not contain quotes'

// Worker env objects live for the whole isolate; validated configs are cached per env object so
// repeated requests skip re-reading and re-validating every variable. Failed validations are
// never cached, so a broken env keeps producing the same error on every request.
const workerConfigCache = new WeakMap<Env, WorkerConfig>()

export function readWorkerConfig(env: Env): WorkerConfig {
  const cachedConfig = workerConfigCache.get(env)
  if (cachedConfig) {
    return cachedConfig
  }
  const config = parseWorkerConfig(env)
  workerConfigCache.set(env, config)
  return config
}

function readRequiredValue(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new Error(`${name} is required`)
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new Error(`${name} must not contain control characters`)
  }
  return normalized
}

function readPath(value: string | undefined, fallback: string, name: string): string {
  const normalized = value === undefined ? fallback : readRequiredValue(value, name)
  if (!normalized.startsWith('/') || normalized.includes('?') || normalized.includes('#')) {
    throw new Error(`${name} ${PATH_MUST_BE_ABSOLUTE_MESSAGE}`)
  }
  if (FORBIDDEN_PATH_CHARACTER_PATTERN.test(normalized)) {
    throw new Error(`${name} ${PATH_MUST_NOT_CONTAIN_QUOTES_MESSAGE}`)
  }
  return normalized
}

function readValueOrFallback(value: string | undefined, fallback: string, name: string): string {
  return value === undefined ? fallback : readRequiredValue(value, name)
}

function assertUniqueValues(entries: ReadonlyArray<readonly [name: string, value: string]>, kind: string): void {
  const owners = new Map<string, string>()
  for (const [name, value] of entries) {
    const existing = owners.get(value)
    if (existing) {
      // Only the conflicting variable names are reported. Embedding the raw value would leak
      // configuration values (R2 object keys, public paths) into error surfaces, which the
      // secret-free error contract forbids.
      throw new Error(`${name} must differ from ${existing}; duplicate ${kind}`)
    }
    owners.set(value, name)
  }
}

function readInvalidKeyMode(value: string | undefined): InvalidKeyMode {
  const normalized = value?.trim().toLowerCase() || 'decoy'
  if (normalized !== 'decoy' && normalized !== 'error') {
    throw new Error('INVALID_KEY_MODE must be one of: decoy, error')
  }
  return normalized
}

function parseWorkerConfig(env: Env): WorkerConfig {
  const config = {
    publicModelPath: readPath(env.PUBLIC_MODEL_PATH, LEGACY_MODEL_PUBLIC_PATH, 'PUBLIC_MODEL_PATH'),
    publicOrtModelPath: readPath(env.PUBLIC_ORT_MODEL_PATH, ORT_MODEL_PUBLIC_PATH, 'PUBLIC_ORT_MODEL_PATH'),
    publicRuntimeWasmPath: readPath(
      env.PUBLIC_RUNTIME_WASM_PATH,
      ORT_RUNTIME_WASM_PUBLIC_PATH,
      'PUBLIC_RUNTIME_WASM_PATH',
    ),
    realModelObjectKey: readRequiredValue(env.REAL_MODEL_OBJECT_KEY, 'REAL_MODEL_OBJECT_KEY'),
    realOrtModelObjectKey: readValueOrFallback(
      env.REAL_ORT_MODEL_OBJECT_KEY,
      ORT_MODEL_OBJECT_KEY,
      'REAL_ORT_MODEL_OBJECT_KEY',
    ),
    decoyModelObjectKey: readRequiredValue(env.DECOY_MODEL_OBJECT_KEY, 'DECOY_MODEL_OBJECT_KEY'),
    runtimeWasmObjectKey: readValueOrFallback(
      env.RUNTIME_WASM_OBJECT_KEY,
      ORT_RUNTIME_WASM_OBJECT_KEY,
      'RUNTIME_WASM_OBJECT_KEY',
    ),
    invalidKeyMode: readInvalidKeyMode(env.INVALID_KEY_MODE),
  }
  assertUniqueValues(
    [
      ['PUBLIC_MODEL_PATH', config.publicModelPath],
      ['PUBLIC_ORT_MODEL_PATH', config.publicOrtModelPath],
      ['PUBLIC_RUNTIME_WASM_PATH', config.publicRuntimeWasmPath],
    ],
    'public path',
  )
  assertUniqueValues(
    [
      ['REAL_MODEL_OBJECT_KEY', config.realModelObjectKey],
      ['REAL_ORT_MODEL_OBJECT_KEY', config.realOrtModelObjectKey],
      ['DECOY_MODEL_OBJECT_KEY', config.decoyModelObjectKey],
      ['RUNTIME_WASM_OBJECT_KEY', config.runtimeWasmObjectKey],
    ],
    'R2 object key',
  )
  return config
}
