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

test('parseModelManifest supports quoted integrity property names', () => {
  const manifest = parseModelManifest(
    `export const MODEL_INTEGRITY = { "byteLength": 3, "sha256": '${sha256}' } as const`,
    { requireVersion: false, sourcePath: 'fixture/model.ts' },
  )

  assert.equal(manifest.version, null)
  assert.equal(manifest.byteLength, 3)
  assert.equal(manifest.sha256, sha256.toLowerCase())
})

test('parseModelManifest ignores decoy manifest literals in comments and strings', () => {
  const decoySha256 = '0'.repeat(64)
  const manifest = parseModelManifest(`
    // export const MODEL_VERSION = 'decoy-version'
    /* export const MODEL_INTEGRITY = { byteLength: 999, sha256: '${decoySha256}' } as const */
    const raw = "MODEL_INTEGRITY = { byteLength: 888, sha256: '${decoySha256}' }"
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

test('parseModelManifest allows trailing comments after MODEL_VERSION', () => {
  const manifest = parseModelManifest(`
    export const MODEL_VERSION = 'model-2026-06-18' // canonical model version
    export const MODEL_INTEGRITY = { byteLength: 3, sha256: '${sha256}' } as const
  `)

  assert.equal(manifest.version, 'model-2026-06-18')
  assert.equal(manifest.byteLength, 3)
})

test('parseModelManifest rejects continued MODEL_VERSION expressions', () => {
  assert.throws(
    () => parseModelManifest(`
      export const MODEL_VERSION = 'model'
        + '-suffix'
      export const MODEL_INTEGRITY = { byteLength: 3, sha256: '${sha256}' } as const
    `, { sourcePath: 'fixture/model.ts' }),
    /Invalid MODEL_VERSION in fixture\/model\.ts: unexpected token after literal value/,
  )
})

test('parseModelManifest rejects continued integrity property expressions', () => {
  assert.throws(
    () => parseModelManifest(`
      export const MODEL_VERSION = 'model'
      export const MODEL_INTEGRITY = {
        byteLength: 3
          + 4,
        sha256: '${sha256}',
      } as const
    `, { sourcePath: 'fixture/model.ts' }),
    /Invalid MODEL_INTEGRITY\.byteLength in fixture\/model\.ts: unexpected token after literal value/,
  )

  assert.throws(
    () => parseModelManifest(`
      export const MODEL_VERSION = 'model'
      export const MODEL_INTEGRITY = {
        byteLength: 3,
        sha256: '${sha256}'
          + 'suffix',
      } as const
    `, { sourcePath: 'fixture/model.ts' }),
    /Invalid MODEL_INTEGRITY\.sha256 in fixture\/model\.ts: unexpected token after literal value/,
  )
})

test('parseModelManifest does not match manifest names inside longer identifiers', () => {
  assert.throws(
    () => parseModelManifest(`
      export const SOME_MODEL_VERSION = 'decoy-version'
      export const SOME_MODEL_INTEGRITY = { byteLength: 3, sha256: '${sha256}' } as const
    `, { sourcePath: 'fixture/model.ts' }),
    /Unable to read MODEL_VERSION from fixture\/model\.ts/,
  )
})

test('parseModelManifest ignores member assignment decoys before canonical exports', () => {
  const manifest = parseModelManifest(`
    globalThis.MODEL_VERSION = 'decoy-version'
    globalThis.MODEL_INTEGRITY = { byteLength: 999, sha256: '${'0'.repeat(64)}' }
    export const MODEL_VERSION = 'model-2026-06-18'
    export const MODEL_INTEGRITY = { byteLength: 3, sha256: '${sha256}' } as const
  `)

  assert.equal(manifest.version, 'model-2026-06-18')
  assert.equal(manifest.byteLength, 3)
  assert.equal(manifest.sha256, sha256.toLowerCase())
})

test('parseModelManifest ignores braces in nested string and template literals', () => {
  const decoySha256 = '0'.repeat(64)
  const manifest = parseModelManifest(`
    export const MODEL_VERSION = 'model-2026-06-18'
    export const MODEL_INTEGRITY = {
      metadata: {
        note: '}',
        template: \`{not-a-direct-property}\`,
        byteLength: 999,
        sha256: '${decoySha256}',
      },
      byteLength: 3,
      sha256: '${sha256}',
    } as const
  `)

  assert.equal(manifest.version, 'model-2026-06-18')
  assert.equal(manifest.byteLength, 3)
  assert.equal(manifest.sha256, sha256.toLowerCase())
})

test('parseModelManifest ignores braces in template literal interpolations and nested templates', () => {
  const decoySha256 = '0'.repeat(64)
  const manifest = parseModelManifest(`
    export const MODEL_VERSION = 'model-2026-06-18'
    export const MODEL_INTEGRITY = {
      metadata: \`outer \${{
        byteLength: 999,
        sha256: '${decoySha256}',
        nested: \`inner }\${{ byteLength: 777, sha256: '${decoySha256}' }}\`,
      }} tail\`,
      byteLength: 3,
      sha256: '${sha256}',
    } as const
  `)

  assert.equal(manifest.version, 'model-2026-06-18')
  assert.equal(manifest.byteLength, 3)
  assert.equal(manifest.sha256, sha256.toLowerCase())
})

test('parseModelManifest reports missing integrity fields with source path', () => {
  assert.throws(
    () => parseModelManifest('export const MODEL_VERSION = "model"', { sourcePath: 'fixture/model.ts' }),
    /Unable to read MODEL_INTEGRITY\.byteLength from fixture\/model\.ts/,
  )
})

test('parseModelManifest rejects invalid sha256 values', () => {
  assert.throws(
    () => parseModelManifest(
      "export const MODEL_VERSION = 'model'\nexport const MODEL_INTEGRITY = { byteLength: 3, sha256: 'not-a-sha256' } as const",
      { sourcePath: 'fixture/model.ts' },
    ),
    /Invalid MODEL_INTEGRITY\.sha256 in fixture\/model\.ts: not-a-sha256/,
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
