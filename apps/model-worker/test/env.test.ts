import { describe, expect, it } from 'vitest'

import { normalizeEnv } from '../src/env'
import type { Env } from '../src/index'
import { createEnv, createModelFixture } from './helpers/model-worker-fixture'

function createValidEnv(): Env {
  return createEnv(createModelFixture())
}

describe('normalizeEnv', () => {
  it('rejects missing MODEL_KEYS binding', () => {
    const env = createValidEnv()
    delete (env as Partial<Env>).MODEL_KEYS

    expect(() => normalizeEnv(env)).toThrow('MODEL_KEYS binding is not configured')
  })

  it('rejects missing MODEL_BUCKET binding', () => {
    const env = createValidEnv()
    delete (env as Partial<Env>).MODEL_BUCKET

    expect(() => normalizeEnv(env)).toThrow('MODEL_BUCKET binding is not configured')
  })

  it('rejects malformed model bindings without a get method', () => {
    const env = createValidEnv()
    env.MODEL_KEYS = {} as Env['MODEL_KEYS']

    expect(() => normalizeEnv(env)).toThrow('MODEL_KEYS binding is not configured')
  })

  it('rejects blank REAL_MODEL_OBJECT_KEY values', () => {
    const env = createValidEnv()
    env.REAL_MODEL_OBJECT_KEY = '   '

    expect(() => normalizeEnv(env)).toThrow('REAL_MODEL_OBJECT_KEY is not configured')
  })

  it('rejects blank DECOY_MODEL_OBJECT_KEY values', () => {
    const env = createValidEnv()
    env.DECOY_MODEL_OBJECT_KEY = '   '

    expect(() => normalizeEnv(env)).toThrow('DECOY_MODEL_OBJECT_KEY is not configured')
  })
})
