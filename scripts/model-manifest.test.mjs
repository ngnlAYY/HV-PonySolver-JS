import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { parseModelManifest, readModelManifest } from './model-manifest.mjs'

const sha256 = 'ABCDEFabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123'

test('parseModelManifest reads version and canonical integrity fields', () => {
  const manifest = parseModelManifest(`
    export const MODEL_VERSION = 'model-2026-06-18'
    export const MODEL_INTEGRITY = {
      byteLength: 1_234,
      sha256: '${sha256}',
    } as const
  `)

  assert.deepEqual(manifest, {
    version: 'model-2026-06-18',
    byteLength: 1234,
    sha256: sha256.toLowerCase(),
  })
})

test('parseModelManifest requires MODEL_VERSION by default', () => {
  assert.throws(
    () => parseModelManifest(`export const MODEL_INTEGRITY = { byteLength: 3, sha256: '${sha256}' } as const`),
    /Unable to read MODEL_VERSION from packages\/shared\/src\/model\.ts/,
  )
})

test('parseModelManifest can parse integrity-only manifests for release scripts', () => {
  const manifest = parseModelManifest(
    `export const MODEL_INTEGRITY = { byteLength: 3, sha256: '${sha256}' } as const`,
    { requireVersion: false, sourcePath: 'fixture/model.ts' },
  )

  assert.equal(manifest.version, null)
  assert.equal(manifest.byteLength, 3)
  assert.equal(manifest.sha256, sha256.toLowerCase())
})

test('parseModelManifest reports missing integrity fields with source path', () => {
  assert.throws(
    () => parseModelManifest('export const MODEL_VERSION = "model"', { sourcePath: 'fixture/model.ts' }),
    /Unable to read MODEL_INTEGRITY\.byteLength from fixture\/model\.ts/,
  )
})

test('readModelManifest reads manifests from the configured repo root and relative path', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'hv-pony-model-manifest-'))
  const relativePath = 'fixtures/model.ts'
  const manifestPath = join(repoRoot, relativePath)
  try {
    await mkdir(dirname(manifestPath), { recursive: true })
    await writeFile(manifestPath, `
      export const MODEL_VERSION = 'fixture-model'
      export const MODEL_INTEGRITY = { byteLength: 3, sha256: '${sha256}' } as const
    `)

    const manifest = await readModelManifest(repoRoot, { relativePath })

    assert.equal(manifest.version, 'fixture-model')
    assert.equal(manifest.byteLength, 3)
    assert.equal(manifest.sha256, sha256.toLowerCase())
  } finally {
    await rm(repoRoot, { recursive: true, force: true })
  }
})
