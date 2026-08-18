import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { browserSupport } from './browser-support.mjs'
import {
  MAX_GECKODRIVER_ARCHIVE_BYTES,
  assertSafeGeckodriverOutputDirectory,
  fetchGeckodriverArchive,
} from './install-geckodriver.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDirectory, '..')
const repositoryRoot = path.resolve(extensionRoot, '../..')

test('guards recursive geckodriver cleanup with canonical temporary roots', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-geckodriver-output-'))
  try {
    const safeOutput = path.join(temporaryRoot, 'driver')
    assert.equal(await assertSafeGeckodriverOutputDirectory(safeOutput), safeOutput)

    for (const dangerousPath of [
      process.cwd(),
      repositoryRoot,
      os.homedir(),
      path.parse(repositoryRoot).root,
      os.tmpdir(),
      path.join(extensionRoot, 'src', 'driver-output'),
    ]) {
      await assert.rejects(
        assertSafeGeckodriverOutputDirectory(dangerousPath),
        /Refusing to recursively remove|outside allowed temporary roots/u,
      )
    }

    const escapingParent = path.join(temporaryRoot, 'source-link')
    await symlink(repositoryRoot, escapingParent, 'dir')
    await assert.rejects(
      assertSafeGeckodriverOutputDirectory(path.join(escapingParent, 'escaped-output')),
      /source tree path/u,
    )

    const externalParent = path.join(temporaryRoot, 'external-link')
    await symlink(os.homedir(), externalParent, 'dir')
    await assert.rejects(
      assertSafeGeckodriverOutputDirectory(path.join(externalParent, 'escaped-output')),
      /outside allowed/u,
    )

    const outputLink = path.join(temporaryRoot, 'output-link')
    await symlink(safeOutput, outputLink, 'dir')
    await assert.rejects(assertSafeGeckodriverOutputDirectory(outputLink), /must not be a symbolic link/u)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('geckodriver downloader streams bounded bytes with the fixed URL and hash', async () => {
  let requestUrl
  let requestOptions
  const body = new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2]))
      controller.enqueue(Uint8Array.from([3, 4]))
      controller.close()
    },
  })
  await assert.rejects(
    fetchGeckodriverArchive({
      fetchImpl: async (url, options) => {
        requestUrl = url
        requestOptions = options
        return new globalThis.Response(body, { headers: { 'content-length': '4' } })
      },
      maxBytes: 8,
      timeoutMs: 1_000,
    }),
    /archive SHA-256 mismatch/u,
  )
  assert.equal(requestUrl, browserSupport.geckodriver.linuxArchiveUrl)
  assert.equal(requestOptions.redirect, 'follow')
  assert.ok(requestOptions.signal instanceof globalThis.AbortSignal)
})

test('geckodriver downloader rejects declared and streamed oversize bodies', async () => {
  let fetchCalled = false
  await assert.rejects(
    fetchGeckodriverArchive({
      fetchImpl: async () => {
        fetchCalled = true
        return new globalThis.Response(Uint8Array.from([1]))
      },
      maxBytes: MAX_GECKODRIVER_ARCHIVE_BYTES + 1,
      timeoutMs: 1_000,
    }),
    /archive byte limit must be between/u,
  )
  assert.equal(fetchCalled, false)

  await assert.rejects(
    fetchGeckodriverArchive({
      fetchImpl: async () => new globalThis.Response(Uint8Array.from([1]), { headers: { 'content-length': '9' } }),
      maxBytes: 8,
      timeoutMs: 1_000,
    }),
    /Content-Length exceeds 8 bytes/u,
  )

  let cancelled = false
  const oversizedBody = new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2, 3]))
      controller.enqueue(Uint8Array.from([4, 5, 6]))
    },
    cancel() {
      cancelled = true
    },
  })
  await assert.rejects(
    fetchGeckodriverArchive({
      fetchImpl: async () => new globalThis.Response(oversizedBody),
      maxBytes: 4,
      timeoutMs: 1_000,
    }),
    /archive exceeds 4 bytes/u,
  )
  assert.equal(cancelled, true)
})

test('geckodriver deadline aborts ignored fetches and hanging body streams', { timeout: 2_000 }, async () => {
  let fetchSignal
  await assert.rejects(
    fetchGeckodriverArchive({
      fetchImpl: async (_url, options) => {
        fetchSignal = options.signal
        return new Promise(() => undefined)
      },
      timeoutMs: 20,
    }),
    /timed out after 20 ms/u,
  )
  assert.equal(fetchSignal.aborted, true)

  let bodySignal
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
    fetchGeckodriverArchive({
      fetchImpl: async (_url, options) => {
        bodySignal = options.signal
        return new globalThis.Response(hangingBody)
      },
      timeoutMs: 20,
    }),
    /timed out after 20 ms/u,
  )
  assert.equal(bodySignal.aborted, true)
  assert.equal(bodyCancelled, true)
})

test('geckodriver downloader reports HTTP, missing-body, and stream errors', async () => {
  await assert.rejects(
    fetchGeckodriverArchive({
      fetchImpl: async () => new globalThis.Response('denied', { status: 503 }),
      timeoutMs: 1_000,
    }),
    /HTTP 503/u,
  )
  await assert.rejects(
    fetchGeckodriverArchive({
      fetchImpl: async () => new globalThis.Response(null),
      timeoutMs: 1_000,
    }),
    /response body is unavailable/u,
  )

  const failedBody = new globalThis.ReadableStream({
    start(controller) {
      controller.error(new Error('broken geckodriver stream'))
    },
  })
  await assert.rejects(
    fetchGeckodriverArchive({
      fetchImpl: async () => new globalThis.Response(failedBody),
      timeoutMs: 1_000,
    }),
    (error) =>
      error?.message === 'geckodriver archive body stream failed' &&
      /broken geckodriver stream/u.test(error.cause?.message),
  )
})
