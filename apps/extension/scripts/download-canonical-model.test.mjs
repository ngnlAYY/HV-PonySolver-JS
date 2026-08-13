import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { downloadCanonicalModel, fetchCanonicalModel } from './download-canonical-model.mjs'

const bytes = Uint8Array.from([1, 2, 3, 4])
const identity = {
  filename: 'canonical.ort',
  byteLength: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}

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
  assert.deepEqual(request[1], {
    headers: { authorization: 'Bearer TOKEN' },
    redirect: 'error',
    signal: undefined,
  })
})

test('canonical downloader fails closed on URL, authentication, length, hash and HTTP errors', async () => {
  await assert.rejects(fetchCanonicalModel({ identity }), /PACKAGED_MODEL_URL is required/u)
  await assert.rejects(
    fetchCanonicalModel({ identity, url: 'http://models.example/canonical.ort' }),
    /must use HTTPS/u,
  )
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
