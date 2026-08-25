import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { zipSync } from 'fflate'

import { createPackagedFixtureModelIdentity } from './build-packaged-fixture.mjs'
import { createPackagedE2eRecord, validatePackagedInferenceObservation } from './packaged-e2e-evidence.mjs'
import {
  PACKAGED_ARCHIVE_LIMITS,
  discoverPackagedArtifact,
  extractAndVerifyPackagedArchive,
  verifyExtractedPackagedTree,
  verifyPackagedArchive,
} from './packaged-smoke-artifact.mjs'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
}

async function createFixtureArtifact(
  outputRoot,
  { includeOracle = true, modelBytes = Buffer.from([1, 2, 3, 4]) } = {},
) {
  const target = 'chromium'
  const model = {
    filename: 'deterministic-captcha.ort',
    byteLength: modelBytes.byteLength,
    sha256: sha256(modelBytes),
    ...(includeOracle ? { expected: { classId: 0, confidence: 0.95 } } : {}),
  }
  const manifestBytes = jsonBytes({
    manifest_version: 3,
    background: { service_worker: 'background.js' },
    host_permissions: ['https://hentaiverse.org/*'],
  })
  const backgroundBytes = Buffer.from('globalThis.fixture = true\n')
  const sourceFiles = {
    'background.js': backgroundBytes,
    'manifest.json': manifestBytes,
    [`model/${model.filename}`]: modelBytes,
  }
  const files = Object.fromEntries(
    Object.entries(sourceFiles).map(([name, bytes]) => [
      name,
      {
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      },
    ]),
  )
  const buildManifest = {
    target,
    version: '0.1.0',
    modelDelivery: 'packaged',
    fixture: true,
    model,
    files,
  }
  const archiveName = 'hv-pony-solver-chromium-packaged-fixture-0.1.0.zip'
  const archiveBytes = Buffer.from(
    zipSync({
      ...sourceFiles,
      'build-manifest.json': jsonBytes(buildManifest),
    }),
  )
  const archive = {
    archiveName,
    byteLength: archiveBytes.byteLength,
    sha256: sha256(archiveBytes),
  }
  const artifact = { ...buildManifest, archive }
  await Promise.all([
    writeFile(path.join(outputRoot, 'chromium.artifact.json'), `${JSON.stringify(artifact)}\n`),
    writeFile(path.join(outputRoot, archiveName), archiveBytes),
    writeFile(path.join(outputRoot, `${archiveName}.sha256`), `${archive.sha256}  ${archiveName}\n`),
  ])
  return { archiveName, artifact }
}

function successfulObservation(overrides = {}) {
  return {
    checkedIndexes: [0],
    panel: '[TS(95.0)]',
    randomFallbackDisabled: true,
    ...overrides,
  }
}

test('fixture identity and discovery fail closed when oracle data is missing', async (context) => {
  assert.throws(
    () =>
      createPackagedFixtureModelIdentity({
        filename: 'fixture.ort',
        byteLength: 1,
        sha256: '1'.repeat(64),
      }),
    /oracle/u,
  )
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-packaged-oracle-'))
  context.after(() => rm(outputRoot, { recursive: true, force: true }))
  await createFixtureArtifact(outputRoot, { includeOracle: false })
  await assert.rejects(discoverPackagedArtifact(outputRoot, 'chromium'), /fixture oracle/u)
})

test('inference evidence rejects random fallback and oracle mismatches', () => {
  const oracle = { classId: 0, confidence: 0.95 }
  assert.throws(
    () =>
      validatePackagedInferenceObservation(
        successfulObservation({
          panel: '识别失败，随机选择 [TS(95.0)]',
        }),
        oracle,
      ),
    /random fallback/u,
  )
  assert.throws(
    () => validatePackagedInferenceObservation(successfulObservation({ checkedIndexes: [1] }), oracle),
    /wrong checkbox index/u,
  )
  assert.throws(
    () => validatePackagedInferenceObservation(successfulObservation({ panel: '[TS(94.0)]' }), oracle),
    /confidence does not match/u,
  )
})

test('archive verification rejects ZIP-byte tampering', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-packaged-zip-tamper-'))
  context.after(() => rm(outputRoot, { recursive: true, force: true }))
  const { archiveName } = await createFixtureArtifact(outputRoot)
  const packagedArtifact = await discoverPackagedArtifact(outputRoot, 'chromium')
  await writeFile(path.join(outputRoot, archiveName), 'tampered ZIP bytes')
  await assert.rejects(verifyPackagedArchive(packagedArtifact), /archive bytes do not match artifact metadata/u)
})

test('artifact discovery rejects oversized uncompressed ZIP entries before extraction', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-packaged-zip-bomb-'))
  context.after(() => rm(outputRoot, { recursive: true, force: true }))
  await createFixtureArtifact(outputRoot, {
    modelBytes: Buffer.alloc(PACKAGED_ARCHIVE_LIMITS.entryByteLength + 1),
  })

  await assert.rejects(discoverPackagedArtifact(outputRoot, 'chromium'), /uncompressed entry size limit/u)
})

test('extracted tree verification rejects post-extraction tampering', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-packaged-tree-tamper-'))
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }))
  await createFixtureArtifact(temporaryRoot)
  const packagedArtifact = await discoverPackagedArtifact(temporaryRoot, 'chromium')
  const extractedRoot = path.join(temporaryRoot, 'extracted')
  const verification = await extractAndVerifyPackagedArchive(packagedArtifact, extractedRoot)
  await writeFile(path.join(extractedRoot, 'background.js'), 'tampered tree')
  await assert.rejects(verifyExtractedPackagedTree(extractedRoot, verification), /does not match the tested archive/u)
})

test('evidence creation binds the exact verified archive and inference oracle', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-packaged-evidence-'))
  context.after(() => rm(outputRoot, { recursive: true, force: true }))
  await createFixtureArtifact(outputRoot)
  const packagedArtifact = await discoverPackagedArtifact(outputRoot, 'chromium')
  const verification = await verifyPackagedArchive(packagedArtifact)
  const observations = [successfulObservation(), successfulObservation()]
  const record = await createPackagedE2eRecord({
    target: 'chromium',
    packagedArtifact,
    archiveVerification: verification,
    browserVersion: '116.0.5845.96',
    observations,
  })
  assert.equal(record.schemaVersion, 2)
  assert.deepEqual(record.oracle, { classId: 0, confidence: 0.95 })
  assert.deepEqual(record.archive, packagedArtifact.artifact.archive)
  assert.deepEqual(
    record.inference.results.map(({ classId, confidence }) => ({ classId, confidence })),
    [
      { classId: 0, confidence: 0.95 },
      { classId: 0, confidence: 0.95 },
    ],
  )

  const mismatchedVerification = {
    ...verification,
    archive: { ...verification.archive, sha256: 'f'.repeat(64) },
  }
  await assert.rejects(
    createPackagedE2eRecord({
      target: 'chromium',
      packagedArtifact,
      archiveVerification: mismatchedVerification,
      browserVersion: '116.0.5845.96',
      observations,
    }),
    /does not match artifact metadata/u,
  )
})
