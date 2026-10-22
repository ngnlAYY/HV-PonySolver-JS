import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setImmediate } from 'node:timers'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'

import { downloadCanonicalModel, fetchCanonicalModel, sha256WithSignal } from './download-canonical-model.mjs'

const bytes = Uint8Array.from([1, 2, 3, 4])
const identity = {
  filename: 'canonical.ort',
  byteLength: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}

const downloaderPath = fileURLToPath(new globalThis.URL('./download-canonical-model.mjs', import.meta.url))

test('canonical downloader refuses redirects and sends an optional bearer token', async () => {
  let request
  const result = await fetchCanonicalModel({
    bearerToken: 'TOKEN',
    fetchImpl: async (...args) => {
      request = args
      return new globalThis.Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
    },
    identity,
    url: 'https://models.example/canonical.ort',
  })
  assert.deepEqual(result.bytes, bytes)
  assert.equal(request[0], 'https://models.example/canonical.ort')
  assert.equal(request[1].headers.authorization, 'Bearer TOKEN')
  assert.equal(request[1].redirect, 'error')
  assert.ok(request[1].signal instanceof globalThis.AbortSignal)
  assert.equal(request[1].signal.aborted, false)
})

test('canonical downloader snapshots reusable stream chunks into the verified result', async () => {
  const chunk = new Uint8Array(1)
  let index = 0
  const body = new globalThis.ReadableStream(
    {
      pull(controller) {
        if (index === bytes.byteLength) {
          chunk.fill(255)
          controller.close()
          return
        }
        chunk[0] = bytes[index++]
        controller.enqueue(chunk)
      },
    },
    { highWaterMark: 0 },
  )
  const result = await fetchCanonicalModel({
    fetchImpl: async () => new globalThis.Response(body),
    identity,
    url: 'https://models.example/canonical.ort',
  })
  assert.deepEqual(result.bytes, bytes)
  assert.equal(body.locked, false)
})

test('canonical downloader fails closed on URL, authentication, length, hash and HTTP errors', async () => {
  await assert.rejects(fetchCanonicalModel({ identity }), /PACKAGED_MODEL_URL is required/u)
  await assert.rejects(fetchCanonicalModel({ identity, url: 'http://models.example/canonical.ort' }), /must use HTTPS/u)
  await assert.rejects(
    downloadCanonicalModel({
      authenticationRequired: true,
      identity,
      url: 'https://models.example/canonical.ort',
    }),
    /PACKAGED_MODEL_BEARER_TOKEN is required/u,
  )
  await assert.rejects(
    fetchCanonicalModel({
      fetchImpl: async () => new globalThis.Response(bytes, { headers: { 'content-length': '3' } }),
      identity,
      url: 'https://models.example/canonical.ort',
    }),
    /Content-Length mismatch/u,
  )
  await assert.rejects(
    fetchCanonicalModel({
      fetchImpl: async () => new globalThis.Response(Uint8Array.from([4, 3, 2, 1])),
      identity,
      url: 'https://models.example/canonical.ort',
    }),
    /SHA-256 mismatch/u,
  )
  await assert.rejects(
    fetchCanonicalModel({
      fetchImpl: async () => new globalThis.Response('denied', { status: 403 }),
      identity,
      url: 'https://models.example/canonical.ort',
    }),
    /HTTP 403/u,
  )
})

test('configuration failures reject credentials before invoking fetch without retaining their values', async () => {
  const marker = 'PUBLIC_CONFIGURATION_SENTINEL'
  for (const [options, expectedMessage] of [
    [{ url: `invalid URL ${marker}` }, 'PACKAGED_MODEL_URL must be a valid HTTPS URL'],
    [
      { url: `https://fixture:${marker}@models.example/canonical.ort` },
      'PACKAGED_MODEL_URL must not contain credentials',
    ],
    ...['\n', '\r', '\0', ' ', '\u0100'].map((invalid) => [
      { url: 'https://models.example/canonical.ort', bearerToken: `${marker}${invalid}suffix` },
      'PACKAGED_MODEL_BEARER_TOKEN must be a valid Bearer token',
    ]),
    ...['\n', '\r\n', ' '].map((invalid) => [
      { url: 'https://models.example/canonical.ort', bearerToken: `${marker}${invalid}` },
      'PACKAGED_MODEL_BEARER_TOKEN must be a valid Bearer token',
    ]),
  ]) {
    let fetchCalls = 0
    await assert.rejects(
      fetchCanonicalModel({
        ...options,
        identity,
        fetchImpl: async () => {
          fetchCalls += 1
          return new globalThis.Response(bytes)
        },
      }),
      (error) => {
        assert.equal(error.message, expectedMessage)
        assert.equal(error.cause, undefined)
        assert.ok(!inspect(error).includes(marker))
        return true
      },
    )
    assert.equal(fetchCalls, 0)
  }
})

test('fetch errors and invalid response length headers do not retain sensitive diagnostics', async () => {
  const marker = 'PUBLIC_DIAGNOSTIC_SENTINEL'
  for (const [fetchImpl, expectedMessage] of [
    [
      async () => {
        throw new Error(marker, { cause: new Error(`nested ${marker}`) })
      },
      'Canonical model request failed',
    ],
    [
      async () => new globalThis.Response(bytes, { headers: { 'content-length': marker } }),
      'Canonical model Content-Length mismatch: expected 4, received invalid',
    ],
  ]) {
    await assert.rejects(
      fetchCanonicalModel({ fetchImpl, identity, url: 'https://models.example/canonical.ort' }),
      (error) => {
        assert.equal(error.message, expectedMessage)
        assert.equal(error.cause, undefined)
        assert.ok(!inspect(error).includes(marker))
        return true
      },
    )
  }
})

test('canonical CLI emits only safe configuration messages for malformed URLs and newline-bearing tokens', () => {
  const marker = 'PUBLIC_CLI_SENTINEL'
  for (const [url, token, expectedMessage] of [
    [`invalid URL ${marker}`, '', 'PACKAGED_MODEL_URL must be a valid HTTPS URL'],
    [
      'https://models.example/canonical.ort',
      `${marker}\nsuffix`,
      'PACKAGED_MODEL_BEARER_TOKEN must be a valid Bearer token',
    ],
  ]) {
    const result = spawnSync(process.execPath, [downloaderPath], {
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        ...process.env,
        PACKAGED_MODEL_URL: url,
        PACKAGED_MODEL_BEARER_TOKEN: token,
        PACKAGED_MODEL_AUTH_REQUIRED: 'false',
      },
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, `${expectedMessage}\n`)
    assert.ok(!`${result.stdout}${result.stderr}`.includes(marker))
  }
})

test('canonical CLI does not print unexpected errors or their nested causes', () => {
  const marker = 'PUBLIC_UNEXPECTED_ERROR_SENTINEL'
  const preload = `globalThis.fetch = async () => ({ get ok() { throw new Error('${marker}', { cause: new Error('${marker}') }) } })`
  const result = spawnSync(
    process.execPath,
    ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, downloaderPath],
    {
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        ...process.env,
        PACKAGED_MODEL_URL: 'https://models.example/canonical.ort',
        PACKAGED_MODEL_BEARER_TOKEN: '',
        PACKAGED_MODEL_AUTH_REQUIRED: 'false',
      },
    },
  )

  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'Canonical model download failed\n')
  assert.ok(!`${result.stdout}${result.stderr}`.includes(marker))
})

test('canonical downloader bounds streamed bytes and reports body failures', async () => {
  const oversizedBody = new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2, 3]))
      controller.enqueue(Uint8Array.from([4, 5]))
      controller.close()
    },
  })
  await assert.rejects(
    fetchCanonicalModel({
      fetchImpl: async () => new globalThis.Response(oversizedBody),
      identity,
      url: 'https://models.example/canonical.ort',
    }),
    /byte length exceeds/u,
  )

  await assert.rejects(
    fetchCanonicalModel({
      fetchImpl: async () => new globalThis.Response(null),
      identity,
      url: 'https://models.example/canonical.ort',
    }),
    /response body is unavailable/u,
  )

  const failedBody = new globalThis.ReadableStream({
    start(controller) {
      controller.error(new Error('broken canonical stream'))
    },
  })
  await assert.rejects(
    fetchCanonicalModel({
      fetchImpl: async () => new globalThis.Response(failedBody),
      identity,
      url: 'https://models.example/canonical.ort',
    }),
    (error) => error?.message === 'Canonical model body stream failed' && error.cause === undefined,
  )
})

test('canonical deadline aborts a hanging body and the same signal bounds hashing', { timeout: 2_000 }, async () => {
  let requestSignal
  let bodyCancelled = false
  const hangingBody = new globalThis.ReadableStream({
    pull() {
      return new Promise(() => undefined)
    },
    cancel() {
      bodyCancelled = true
    },
  })
  await assert.rejects(
    fetchCanonicalModel({
      fetchImpl: async (_url, request) => {
        requestSignal = request.signal
        return new globalThis.Response(hangingBody)
      },
      identity,
      timeoutMs: 25,
      url: 'https://models.example/canonical.ort',
    }),
    /timed out after 25 ms/u,
  )
  assert.equal(requestSignal.aborted, true)
  assert.equal(bodyCancelled, true)

  const hashController = new globalThis.AbortController()
  const hashPromise = sha256WithSignal(new Uint8Array(3 * 1024 * 1024), hashController.signal)
  setImmediate(() => hashController.abort(new Error('hash cancelled')))
  await assert.rejects(hashPromise, /hash cancelled/u)
})

test('canonical downloader writes verified bytes atomically', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hv-canonical-model-'))
  const destination = path.join(root, 'model', identity.filename)
  try {
    const result = await downloadCanonicalModel({
      destination,
      fetchImpl: async () => new globalThis.Response(bytes),
      identity,
      url: 'https://models.example/canonical.ort',
    })
    assert.equal(result.destination, destination)
    assert.deepEqual(new Uint8Array(await readFile(destination)), bytes)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
