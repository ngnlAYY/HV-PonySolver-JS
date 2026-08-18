import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TextEncoder } from 'node:util'

import { zipSync } from 'fflate'

import { findArtifactIdentity, parseArguments } from './benchmark-runner.mjs'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function writeArtifact(root, { target = 'firefox', version = '9.9.9', packaged = false } = {}) {
  const wasmPath = 'runtime/test.wasm'
  const wasmBytes = Uint8Array.from([1, 2, 3, 4])
  const files = {
    [wasmPath]: { byteLength: wasmBytes.byteLength, sha256: sha256(wasmBytes) },
  }
  const model = packaged
    ? { filename: 'test-model.ort', byteLength: 3, sha256: sha256(Uint8Array.from([8, 9, 10])) }
    : null
  if (model) {
    files[`model/${model.filename}`] = model
  }
  const artifactName = `arbitrary-${target}-${version}${packaged ? '-packaged' : ''}.artifact.json`
  const archiveName = `hv-pony-solver-${target}-${version}${packaged ? '-packaged' : ''}.zip`
  const buildManifest = {
    target,
    version,
    modelDelivery: packaged ? 'packaged' : 'remote',
    ...(packaged ? { model } : {}),
    ...(packaged ? { fixture: true } : {}),
    files,
  }
  const archive = zipSync({
    [wasmPath]: wasmBytes,
    ...(model ? { [`model/${model.filename}`]: Uint8Array.from([8, 9, 10]) } : {}),
    'build-manifest.json': new TextEncoder().encode(JSON.stringify(buildManifest)),
  })
  const artifact = {
    target,
    version,
    modelDelivery: packaged ? 'packaged' : 'remote',
    ...(packaged ? { model } : {}),
    ...(packaged ? { fixture: true } : {}),
    archive: { archiveName, byteLength: archive.byteLength, sha256: sha256(archive) },
    files,
  }
  await writeFile(path.join(root, archiveName), archive)
  await writeFile(path.join(root, `${archiveName}.sha256`), `${artifact.archive.sha256}  ${archiveName}\n`)
  await writeFile(path.join(root, artifactName), `${JSON.stringify(artifact)}\n`)
  return artifact
}

test('uses transport-only representative defaults and an explicit exhaustive selector', () => {
  const defaults = parseArguments([])
  assert.deepEqual(defaults.imageBytes, [1_024, 2_097_152])
  assert.equal(defaults.matrixProfile, 'representative')
  assert.equal(Object.hasOwn(defaults, 'modes'), false)
  assert.equal(Object.hasOwn(defaults, 'caches'), false)
  assert.throws(() => parseArguments(['--mode', 'remote']), /Unknown benchmark argument/u)

  const exhaustive = parseArguments(['--exhaustive', '--dry-run'])
  assert.deepEqual(exhaustive.imageBytes, [1_024, 262_144, 2_097_152])
  assert.equal(exhaustive.matrixProfile, 'exhaustive')
})

test('discovers and verifies artifact archive, model, WASM, and dynamic version provenance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hv-benchmark-artifact-'))
  try {
    const artifact = await writeArtifact(root, { target: 'firefox', version: '9.9.9' })
    const identity = await findArtifactIdentity(root, 'firefox')
    assert.deepEqual(identity, {
      target: 'firefox',
      version: artifact.version,
      modelDelivery: 'remote',
      fixture: false,
      archive: artifact.archive,
      model: null,
      wasm: {
        path: 'runtime/test.wasm',
        byteLength: 4,
        sha256: artifact.files['runtime/test.wasm'].sha256,
      },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects artifact checksum and packaged model provenance drift', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hv-benchmark-artifact-invalid-'))
  try {
    const artifact = await writeArtifact(root, { target: 'firefox', version: '9.9.9', packaged: true })
    const identity = await findArtifactIdentity(root, 'firefox')
    assert.equal(identity.modelDelivery, 'packaged')
    assert.deepEqual(identity.model, artifact.model)
    await writeFile(
      path.join(root, `${artifact.archive.archiveName}.sha256`),
      `${'0'.repeat(64)}  ${artifact.archive.archiveName}\n`,
    )
    await assert.rejects(findArtifactIdentity(root, 'firefox'), /checksum sidecar/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
