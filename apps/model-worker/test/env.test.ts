import { describe, expect, it } from 'vitest'

import { ORT_MODEL_OBJECT_KEY } from '@hv-pony-solver/shared'

import { readWorkerConfig } from '../src/env'
import { createEnv, createModelFixture } from './helpers/model-worker-fixture'

function readWorkerConfigError(env: Parameters<typeof readWorkerConfig>[0]): Error {
  try {
    readWorkerConfig(env)
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  throw new Error('readWorkerConfig unexpectedly succeeded')
}

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

  it('uses the dedicated quota path and defaults quota enforcement on', () => {
    const fixture = createModelFixture()
    const config = readWorkerConfig(createEnv(fixture))
    expect(config.publicQuotaPath).toBe(fixture.publicQuotaPath)
    expect(config.downloadQuotaEnabled).toBe(true)
  })

  it('accepts an explicit quota enforcement switch', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { quotaEnabled: false })
    expect(readWorkerConfig(env).downloadQuotaEnabled).toBe(false)

    const enabledEnv = createEnv(createModelFixture(), { quotaEnabled: true })
    expect(readWorkerConfig(enabledEnv).downloadQuotaEnabled).toBe(true)
  })

  it('rejects invalid quota enforcement values', () => {
    const env = createEnv(createModelFixture())
    env.MODEL_DOWNLOAD_QUOTA_ENABLED = 'sometimes'
    expect(() => readWorkerConfig(env)).toThrow('MODEL_DOWNLOAD_QUOTA_ENABLED must be true or false')
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

  it.each(['', '   '])('rejects an explicitly empty public path instead of using its default: %j', (path) => {
    const env = createEnv(createModelFixture())
    env.PUBLIC_MODEL_PATH = path

    expect(() => readWorkerConfig(env)).toThrow(/PUBLIC_MODEL_PATH.*required/u)
  })

  describe.each([
    ['PUBLIC_MODEL_PATH', 'publicModelPath'],
    ['PUBLIC_QUOTA_PATH', 'publicQuotaPath'],
    ['PUBLIC_ORT_MODEL_PATH', 'publicOrtModelPath'],
    ['PUBLIC_RUNTIME_WASM_PATH', 'publicRuntimeWasmPath'],
  ] as const)('%s pathname boundaries', (name, property) => {
    it.each([
      '/models/../quota',
      '/models/./a.onnx',
      '/models/%2e%2e/quota',
      '/models/.%2E/quota',
      '/models/%2E./quota',
      '/models/%2E/a.onnx',
      '/models/.',
      '/models/..',
      '/models/a b.onnx',
      '/models/a.onnx ',
      '/模型/a.onnx',
      '/models/<model>.onnx',
      '/models/\uD800.onnx',
    ])('rejects URL-normalized aliases without disclosing the value: %j', (path) => {
      const env = createEnv(createModelFixture())
      env[name] = path

      expect(readWorkerConfigError(env).message).toBe(`${name} must be a canonical URL pathname`)
    })

    it.each(['models/a.onnx', '//models.example/a.onnx', '///models/a.onnx', '/a?query', '/a#hash', ' /a.onnx'])(
      'rejects inputs that are not origin-relative pathnames: %j',
      (path) => {
        const env = createEnv(createModelFixture())
        env[name] = path

        expect(readWorkerConfigError(env).message).toBe(`${name} must be an absolute pathname`)
      },
    )

    it.each(['/models/\ta.onnx', '/models/a.onnx\n', '/models/a\u007f.onnx'])(
      'rejects control characters before URL parsing: %j',
      (path) => {
        const env = createEnv(createModelFixture())
        env[name] = path

        expect(readWorkerConfigError(env).message).toBe(`${name} must not contain control characters`)
      },
    )

    it.each([
      '/',
      '/models/a%20b.onnx',
      '/%E6%A8%A1%E5%9E%8B/a.onnx',
      '/models/%2e.onnx',
      '/models/%252e%252e/quota',
      '/models/%2F%3F%23%22%27%60%5C.onnx',
      '/models/%2f%41%7e.onnx',
      '/models//a.onnx',
    ])('preserves canonical pathname bytes: %j', (path) => {
      const env = createEnv(createModelFixture())
      env[name] = path

      expect(readWorkerConfig(env)[property]).toBe(path)
    })

    it('includes the omitted route default when checking for collisions', () => {
      const fixture = createModelFixture()
      const defaultsEnv = createEnv(fixture)
      delete defaultsEnv[name]
      const fallback = readWorkerConfig(defaultsEnv)[property]
      const env = createEnv(fixture)
      delete env[name]
      const otherName = name === 'PUBLIC_MODEL_PATH' ? 'PUBLIC_QUOTA_PATH' : 'PUBLIC_MODEL_PATH'
      env[otherName] = fallback

      const error = readWorkerConfigError(env)

      expect(error.message).toContain('duplicate public path')
      expect(error.message).toContain(name)
      expect(error.message).toContain(otherName)
      expect(error.message).not.toContain(fallback)
    })
  })

  it('rejects colliding public paths without embedding the path value', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    env.PUBLIC_ORT_MODEL_PATH = fixture.publicModelPath

    const error = readWorkerConfigError(env)

    expect(error.message).toMatch(/duplicate public path/)
    expect(error.message).toContain('PUBLIC_ORT_MODEL_PATH must differ from PUBLIC_MODEL_PATH')
    expect(error.message).not.toContain(fixture.publicModelPath)
  })

  it('rejects a quota path that collides with a model path without embedding the path value', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    env.PUBLIC_QUOTA_PATH = fixture.publicModelPath

    const error = readWorkerConfigError(env)

    expect(error.message).toMatch(/duplicate public path/)
    expect(error.message).toContain('PUBLIC_QUOTA_PATH must differ from PUBLIC_MODEL_PATH')
    expect(error.message).not.toContain(fixture.publicModelPath)
  })

  it('rejects real, decoy, and public runtime object-key collisions without embedding the key value', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    env.RUNTIME_WASM_OBJECT_KEY = fixture.realOrtModelObjectKey

    const error = readWorkerConfigError(env)

    expect(error.message).toMatch(/duplicate R2 object key/)
    expect(error.message).toContain('RUNTIME_WASM_OBJECT_KEY must differ from REAL_ORT_MODEL_OBJECT_KEY')
    expect(error.message).not.toContain(fixture.realOrtModelObjectKey)
  })

  it('rejects control characters in configured object keys', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    env.REAL_MODEL_OBJECT_KEY = `${fixture.realModelObjectKey}\nunsafe`

    expect(() => readWorkerConfig(env)).toThrow(/control characters/)
  })

  it('rejects double quotes in configured public paths', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    env.PUBLIC_MODEL_PATH = `${fixture.publicModelPath}"`

    const error = readWorkerConfigError(env)

    expect(error.message).toBe('PUBLIC_MODEL_PATH must not contain quotes or backslashes')
  })

  it('rejects single quotes in configured public paths', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    env.PUBLIC_ORT_MODEL_PATH = `${fixture.publicOrtModelPath}'`

    expect(() => readWorkerConfig(env)).toThrow('PUBLIC_ORT_MODEL_PATH must not contain quotes or backslashes')
  })

  it('rejects backticks in configured public paths', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    env.PUBLIC_RUNTIME_WASM_PATH = `${fixture.publicRuntimeWasmPath}\``

    expect(() => readWorkerConfig(env)).toThrow('PUBLIC_RUNTIME_WASM_PATH must not contain quotes or backslashes')
  })

  it('rejects backslashes in configured public paths', () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture)
    env.PUBLIC_QUOTA_PATH = `${fixture.publicQuotaPath}\\unsafe`

    expect(() => readWorkerConfig(env)).toThrow('PUBLIC_QUOTA_PATH must not contain quotes or backslashes')
  })

  it('reuses the validated config for the same env object without re-validating', () => {
    const env = createEnv(createModelFixture())
    let invalidKeyModeReads = 0
    Object.defineProperty(env, 'INVALID_KEY_MODE', {
      configurable: true,
      get() {
        invalidKeyModeReads += 1
        return undefined
      },
    })

    readWorkerConfig(env)
    readWorkerConfig(env)

    expect(invalidKeyModeReads).toBe(1)
  })

  it('does not cache failed validations, so a repaired env validates again', () => {
    const env = createEnv(createModelFixture())
    env.REAL_MODEL_OBJECT_KEY = ''

    expect(() => readWorkerConfig(env)).toThrow('REAL_MODEL_OBJECT_KEY is required')

    env.REAL_MODEL_OBJECT_KEY = 'real/repaired.onnx'
    expect(readWorkerConfig(env).realModelObjectKey).toBe('real/repaired.onnx')
  })
})
