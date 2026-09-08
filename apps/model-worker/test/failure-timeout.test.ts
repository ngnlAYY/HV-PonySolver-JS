/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, expect, it, vi } from 'vitest'

import type { SelectedModelAccess } from '../src/model-access'
import type { InvalidKeyMode, ModelKeyStore } from '../src/worker-types'

const modelAccessMocks = vi.hoisted(() => ({
  selectModelAccess:
    vi.fn<
      (request: Request, keyStore: ModelKeyStore, invalidKeyMode: InvalidKeyMode) => Promise<SelectedModelAccess>
    >(),
}))

vi.mock(import('../src/model-access'), async (importOriginal) => {
  const modelAccess = await importOriginal()
  modelAccessMocks.selectModelAccess.mockImplementation(modelAccess.selectModelAccess)
  return {
    ...modelAccess,
    selectModelAccess: modelAccessMocks.selectModelAccess,
  }
})

import { MODEL_INTEGRITY } from '@hv-pony-solver/shared'

import { MODEL_WORKER_DEPENDENCY_TIMEOUT_MS } from '../src/request-timeout'
import {
  assetRequest,
  createEnv,
  createModelFixture,
  fetchWorker,
  type MockModelDownloadQuotaNamespace,
  type MockR2Bucket,
  modelRequest,
  readResponseBody,
  type StoredObject,
} from './helpers/model-worker-fixture'
import { authorizedModelRequest } from './helpers/model-worker-test-support'

describe('failure-timeout', () => {
  it('returns 500 text when the selected R2 object is missing', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(
      authorizedModelRequest(fixture, 'GET'),
      createEnv(fixture, {
        keyValues: new Map<string, string>([[fixture.validKey, '1']]),
        objects: new Map<string, StoredObject>([[fixture.decoyModelObjectKey, { body: fixture.decoyBody }]]),
      }),
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.text()).toBe('Internal Server Error')
  })

  it('fails closed before reserving quota when real model metadata drifts', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
      objects: new Map<string, StoredObject>([
        [
          fixture.realModelObjectKey,
          {
            body: fixture.realBody,
            cancelError: new Error('cancel failed'),
            size: MODEL_INTEGRITY.byteLength - 1,
          },
        ],
        [fixture.decoyModelObjectKey, { body: fixture.decoyBody }],
      ]),
    })

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Internal Server Error')
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedPaths).toEqual(['/status'])
  })

  it('fails closed on real model HEAD metadata drift without expecting a response body', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
      objects: new Map<string, StoredObject>([
        [fixture.realModelObjectKey, { body: fixture.realBody, size: MODEL_INTEGRITY.byteLength - 1 }],
        [fixture.decoyModelObjectKey, { body: fixture.decoyBody }],
      ]),
    })

    const response = await fetchWorker(authorizedModelRequest(fixture, 'HEAD'), env)

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Internal Server Error')
    expect((env.MODEL_BUCKET as MockR2Bucket).headRequestedKeys).toEqual([fixture.realModelObjectKey])
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedIdentities).toEqual([])
  })

  it('returns a generic 500 when real access has no canonical token', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })
    modelAccessMocks.selectModelAccess.mockResolvedValueOnce({ decision: 'real', canonicalToken: null })

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Internal Server Error')
  })

  it('returns 500 instead of silently falling back when INVALID_KEY_MODE is unsupported', async () => {
    const fixture = createModelFixture()
    const response = await fetchWorker(modelRequest(fixture, 'GET'), createEnv(fixture, { invalidKeyMode: 'allow' }))

    expect(response.status).toBe(500)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.text()).toBe('Internal Server Error')
  })

  it('returns 500 with CORS when required environment config is missing', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map<string, string>([[fixture.validKey, '1']]),
    })
    env.REAL_MODEL_OBJECT_KEY = ''

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)

    expect(response.status).toBe(500)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.text()).toBe('Internal Server Error')
  })

  it('converts KV and R2 failures into generic secret-free errors', async () => {
    const fixture = createModelFixture()
    const keyFailure = await fetchWorker(
      authorizedModelRequest(fixture, 'GET'),
      createEnv(fixture, { keyError: new Error(`KV failed for ${fixture.validKey}`) }),
    )
    const getFailure = await fetchWorker(
      modelRequest(fixture, 'GET'),
      createEnv(fixture, { bucketGetError: new Error(`R2 GET failed for ${fixture.decoyModelObjectKey}`) }),
    )
    const headFailure = await fetchWorker(
      assetRequest(fixture.publicRuntimeWasmPath, 'HEAD'),
      createEnv(fixture, { bucketHeadError: new Error(`R2 HEAD failed for ${fixture.runtimeWasmObjectKey}`) }),
    )

    for (const response of [keyFailure, getFailure, headFailure]) {
      expect(response.status).toBe(500)
      expect(await response.text()).toBe('Internal Server Error')
    }
  })

  it('bounds hanging KV and R2 dependencies and fails closed', async () => {
    vi.useFakeTimers()
    try {
      const fixture = createModelFixture()
      const keyEnv = createEnv(fixture)
      keyEnv.MODEL_KEYS = { get: () => new Promise<never>(() => undefined) }
      const getEnv = createEnv(fixture)
      const getBucket = getEnv.MODEL_BUCKET
      getEnv.MODEL_BUCKET = {
        get: () => new Promise<never>(() => undefined),
        head: (key) => getBucket.head(key),
      }
      const headEnv = createEnv(fixture)
      const headBucket = headEnv.MODEL_BUCKET
      headEnv.MODEL_BUCKET = {
        get: (key) => headBucket.get(key),
        head: () => new Promise<never>(() => undefined),
      }
      const responsePromises = [
        fetchWorker(authorizedModelRequest(fixture, 'GET'), keyEnv),
        fetchWorker(modelRequest(fixture, 'GET'), getEnv),
        fetchWorker(assetRequest(fixture.publicRuntimeWasmPath, 'HEAD'), headEnv),
      ]
      const settled = Promise.all(responsePromises).then(() => 'settled' as const)
      const sentinel = new Promise<'hung'>((resolve) => {
        setTimeout(() => resolve('hung'), MODEL_WORKER_DEPENDENCY_TIMEOUT_MS + 1)
      })

      await vi.advanceTimersByTimeAsync(MODEL_WORKER_DEPENDENCY_TIMEOUT_MS + 1)

      expect(await Promise.race([settled, sentinel])).toBe('settled')
      const responses = await Promise.all(responsePromises)
      for (const response of responses) {
        expect(response.status).toBe(500)
        expect(await response.text()).toBe('Internal Server Error')
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns a retryable 503 when quota storage fails', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map([[fixture.validKey, '1']]),
      quotaStatusError: new Error(`quota failed for ${fixture.validKey}`),
    })
    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('5')
    expect(response.headers.get('access-control-expose-headers')).toBe('Retry-After')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('Service Unavailable')
    expect((env.MODEL_BUCKET as MockR2Bucket).requestedKeys).toEqual([])
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedPaths).toEqual(['/status'])
  })

  it('keeps the reserve failure cleanup path after quota preflight succeeds', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, {
      keyValues: new Map([[fixture.validKey, '1']]),
      quotaReserveError: new Error('quota reserve failed'),
    })
    const getObject = vi.spyOn(env.MODEL_BUCKET, 'get')

    const response = await fetchWorker(authorizedModelRequest(fixture, 'GET'), env)

    expect(response.status).toBe(503)
    expect(await response.text()).toBe('Service Unavailable')
    expect((env.MODEL_BUCKET as MockR2Bucket).requestedKeys).toEqual([fixture.realModelObjectKey])
    expect((env.MODEL_DOWNLOAD_QUOTAS as MockModelDownloadQuotaNamespace).requestedPaths).toEqual([
      '/status',
      '/reserve',
    ])
    const object = await getObject.mock.results[0]?.value
    expect(await object?.body.getReader().read()).toEqual({ done: true, value: undefined })
  })

  it('logs only secret-free classification fields when quota storage fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fixture = createModelFixture()
      const response = await fetchWorker(
        authorizedModelRequest(fixture, 'GET'),
        createEnv(fixture, {
          keyValues: new Map<string, string>([[fixture.validKey, '1']]),
          quotaError: new Error(`quota failed for ${fixture.validKey}`),
        }),
      )

      expect(response.status).toBe(503)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const logged = warnSpy.mock.calls.flat().join(' ')
      expect(logged).toContain('route=legacy-model')
      expect(logged).toContain('errorKind=quota-storage-unavailable')
      expect(logged).not.toContain('quota failed')
      expect(logged).not.toContain(fixture.validKey)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('logs only secret-free classification fields for unhandled failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const fixture = createModelFixture()
      const response = await fetchWorker(
        modelRequest(fixture, 'GET'),
        createEnv(fixture, { bucketGetError: new Error(`R2 GET failed for ${fixture.decoyModelObjectKey}`) }),
      )

      expect(response.status).toBe(500)
      expect(errorSpy).toHaveBeenCalledTimes(1)
      const logged = errorSpy.mock.calls.flat().join(' ')
      expect(logged).toContain('route=legacy-model')
      expect(logged).toContain('errorKind=unhandled-exception')
      expect(logged).toContain('errorName=Error')
      expect(logged).not.toContain('R2 GET failed')
      expect(logged).not.toContain(fixture.decoyModelObjectKey)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('keeps concurrent real, decoy, and public runtime requests isolated', async () => {
    const fixture = createModelFixture()
    const env = createEnv(fixture, { keyValues: new Map([[fixture.validKey, '1']]) })

    const [realResponse, decoyResponse, runtimeResponse] = await Promise.all([
      fetchWorker(authorizedModelRequest(fixture, 'GET'), env),
      fetchWorker(modelRequest(fixture, 'GET'), env),
      fetchWorker(assetRequest(fixture.publicRuntimeWasmPath, 'GET'), env),
    ])

    await expect(readResponseBody(realResponse)).resolves.toBe(fixture.realBody)
    await expect(readResponseBody(decoyResponse)).resolves.toBe(fixture.decoyBody)
    await expect(readResponseBody(runtimeResponse)).resolves.toBe(fixture.runtimeBody)
  })
})
