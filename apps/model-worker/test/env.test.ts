import { describe, expect, it } from 'vitest'

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

  it('uses the content-addressed runtime route', () => {
    const fixture = createModelFixture()
    const config = readWorkerConfig(createEnv(fixture))
    expect(config.publicRuntimeWasmPath).toBe(fixture.publicRuntimeWasmPath)
    expect(config.runtimeWasmObjectKey).toBe(fixture.runtimeWasmObjectKey)
  })
})
