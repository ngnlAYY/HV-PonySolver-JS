import { describe, expect, it } from 'vitest'

import { ORT_MODEL_OBJECT_KEY } from '@hv-pony-solver/shared'

import { readWorkerConfig } from '../src/env'
import { createEnv, createModelFixture } from './helpers/model-worker-fixture'

describe('readWorkerConfig', () => {
  it('normalizes the invalid-key mode', () => {
    const env = createEnv(createModelFixture(), { invalidKeyMode: ' ERROR ' })
    expect(readWorkerConfig(env).invalidKeyMode).toBe('error')
  })

  it('defaults to decoy mode', () => {
    expect(readWorkerConfig(createEnv(createModelFixture())).invalidKeyMode).toBe('decoy')
  })

  it('rejects unsupported invalid-key modes', () => {
    const env = createEnv(createModelFixture(), { invalidKeyMode: 'allow' })
    expect(() => readWorkerConfig(env)).toThrow('INVALID_KEY_MODE')
  })

  it('uses the dedicated ORT model path and object key', () => {
    const fixture = createModelFixture()
    const config = readWorkerConfig(createEnv(fixture))
    expect(config.publicOrtModelPath).toBe(fixture.publicOrtModelPath)
    expect(config.realOrtModelObjectKey).toBe(fixture.realOrtModelObjectKey)
  })

  it('defaults the optional ORT object key when omitted', () => {
    const env = createEnv(createModelFixture())
    delete env.REAL_ORT_MODEL_OBJECT_KEY

    expect(readWorkerConfig(env).realOrtModelObjectKey).toBe(ORT_MODEL_OBJECT_KEY)
  })

  it('uses the content-addressed runtime route', () => {
    const fixture = createModelFixture()
    const config = readWorkerConfig(createEnv(fixture))
    expect(config.publicRuntimeWasmPath).toBe(fixture.publicRuntimeWasmPath)
    expect(config.runtimeWasmObjectKey).toBe(fixture.runtimeWasmObjectKey)
  })

  it('rejects public asset paths that are not absolute pathnames', () => {
    const env = createEnv(createModelFixture())
    env.PUBLIC_MODEL_PATH = 'relative-model.onnx'

    expect(() => readWorkerConfig(env)).toThrow(/absolute pathname/)
  })

  it('rejects colliding public paths', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    env.PUBLIC_ORT_MODEL_PATH = fixture.publicModelPath

    expect(() => readWorkerConfig(env)).toThrow(/duplicate public path/)
  })

  it('rejects real, decoy, and public runtime object-key collisions', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    env.RUNTIME_WASM_OBJECT_KEY = fixture.realOrtModelObjectKey

    expect(() => readWorkerConfig(env)).toThrow(/duplicate R2 object key/)
  })

  it('rejects control characters in configured object keys', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    env.REAL_MODEL_OBJECT_KEY = `${fixture.realModelObjectKey}\nunsafe`

    expect(() => readWorkerConfig(env)).toThrow(/control characters/)
  })
})
