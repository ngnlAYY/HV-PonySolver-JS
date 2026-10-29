import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TextEncoder } from 'node:util'

import { chromium, firefox } from '@playwright/test'
import { zipSync } from 'fflate'

import { estimateBenchmarkBudget, findArtifactIdentity, main, parseArguments } from './benchmark-runner.mjs'
import { EXTENSION_ARCHIVE_LIMITS } from '../build/archive-reader.mjs'

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

test('provides a bounded CI transport profile and exposes the full-run work budget', () => {
  const ci = parseArguments(['--ci'])
  assert.deepEqual(ci.browsers, ['chromium'])
  assert.deepEqual(ci.imageBytes, [1_024, 262_144])
  assert.deepEqual(ci.iterations, [100])
  assert.deepEqual(ci.patterns, ['sequential', 'burst'])
  assert.equal(ci.invocations, 1)
  assert.equal(ci.warmups, 1)
  assert.equal(ci.samples, 3)
  assert.equal(ci.allowReducedSampling, true)

  const ciBudget = estimateBenchmarkBudget(ci)
  assert.equal(ciBudget.scenarioCount, 4)
  assert.equal(ciBudget.totalOperations, 1_600)
  assert.ok(ciBudget.totalPayloadBytes <= 256 * 1024 * 1024)

  const fullBudget = estimateBenchmarkBudget(parseArguments([]))
  assert.equal(fullBudget.scenarioCount, 16)
  assert.equal(fullBudget.totalOperations, 343_200)
  assert.ok(fullBudget.totalPayloadBytes > 300 * 1024 * 1024 * 1024)
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

test('rejects oversized ZIP declarations before decompressing benchmark artifacts', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hv-benchmark-zip-limit-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const artifact = await writeArtifact(root)
  const archivePath = path.join(root, artifact.archive.archiveName)
  const archive = await readFile(archivePath)
  const centralHeader = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.ok(centralHeader >= 0)
  archive.writeUInt32LE(EXTENSION_ARCHIVE_LIMITS.entryByteLength + 1, centralHeader + 24)
  artifact.archive.sha256 = sha256(archive)
  await writeFile(archivePath, archive)
  await writeFile(`${archivePath}.sha256`, `${artifact.archive.sha256}  ${artifact.archive.archiveName}\n`)
  await writeFile(path.join(root, 'arbitrary-firefox-9.9.9.artifact.json'), JSON.stringify(artifact))
  await assert.rejects(findArtifactIdentity(root, 'firefox'), (error) => {
    assert.match(error.message, /archive is not a valid ZIP/u)
    assert.match(error.cause?.message, /uncompressed entry size limit/u)
    return true
  })
})

test('rejects oversized compressed metadata and non-file benchmark archives before reading bytes', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hv-benchmark-archive-file-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const artifact = await writeArtifact(root)
  const artifactPath = path.join(root, 'arbitrary-firefox-9.9.9.artifact.json')
  const byteLength = artifact.archive.byteLength
  artifact.archive.byteLength = EXTENSION_ARCHIVE_LIMITS.archiveByteLength + 1
  await writeFile(artifactPath, JSON.stringify(artifact))
  await assert.rejects(findArtifactIdentity(root, 'firefox'), /compressed size limit/u)

  artifact.archive.byteLength = byteLength
  await writeFile(artifactPath, JSON.stringify(artifact))
  const archivePath = path.join(root, artifact.archive.archiveName)
  const externalPath = path.join(root, 'external.zip')
  await writeFile(externalPath, await readFile(archivePath))
  await rm(archivePath)
  await symlink(externalPath, archivePath)
  await assert.rejects(findArtifactIdentity(root, 'firefox'), /archive bytes do not match/u)
})

test('reduced benchmark sampling rejects one sample and accepts the bootstrap minimum', () => {
  assert.throws(() => parseArguments(['--ci', '--samples', '1']), /at least 2 measured samples/u)
  assert.throws(() => parseArguments(['--quick', '--samples', '1']), /at least 2 measured samples/u)
  assert.equal(parseArguments(['--ci', '--samples', '2']).samples, 2)
})

for (const [name, browserType, version] of [
  ['chromium', chromium, '115.0'],
  ['firefox', firefox, '139.0'],
]) {
  for (const closeFails of [false, true]) {
    test(`closes rejected ${name} before session ownership transfers, close failure: ${closeFails}`, async (context) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'hv-benchmark-rejected-browser-'))
      context.after(() => rm(root, { recursive: true, force: true }))
      let closed = false
      context.mock.method(browserType, 'launch', async () => ({
        version: () => version,
        async close() {
          closed = true
          if (closeFails) throw new Error('fixture browser close failed')
        },
      }))
      await assert.rejects(
        main(['--quick', '--browser', name, '--artifact-root', root, '--output-dir', root]),
        new RegExp(`${name} ${version} is below the supported major`, 'u'),
      )
      assert.equal(closed, true)
    })
  }
}
