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

function replaceArchiveEntryName(archiveBytes, sourceName, targetName) {
  const source = Buffer.from(sourceName)
  const target = Buffer.from(targetName)
  assert.equal(source.byteLength, target.byteLength, 'ZIP entry names must have equal byte lengths')
  const patched = Buffer.from(archiveBytes)

  let localOffset = 0
  let localReplacements = 0
  while (patched.readUInt32LE(localOffset) === 0x04034b50) {
    const flags = patched.readUInt16LE(localOffset + 6)
    assert.equal(flags & 0x08, 0, 'fixture ZIP must record compressed sizes in local headers')
    const compressedByteLength = patched.readUInt32LE(localOffset + 18)
    const nameByteLength = patched.readUInt16LE(localOffset + 26)
    const extraByteLength = patched.readUInt16LE(localOffset + 28)
    const nameOffset = localOffset + 30
    if (patched.subarray(nameOffset, nameOffset + nameByteLength).equals(source)) {
      target.copy(patched, nameOffset)
      localReplacements += 1
    }
    localOffset = nameOffset + nameByteLength + extraByteLength + compressedByteLength
  }

  const endOfCentralDirectory = patched.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.notEqual(endOfCentralDirectory, -1, 'fixture ZIP must contain an end-of-central-directory record')
  const centralEntryCount = patched.readUInt16LE(endOfCentralDirectory + 10)
  let centralOffset = patched.readUInt32LE(endOfCentralDirectory + 16)
  let centralReplacements = 0
  for (let entryIndex = 0; entryIndex < centralEntryCount; entryIndex += 1) {
    assert.equal(patched.readUInt32LE(centralOffset), 0x02014b50, 'fixture ZIP central entry is invalid')
    const nameByteLength = patched.readUInt16LE(centralOffset + 28)
    const extraByteLength = patched.readUInt16LE(centralOffset + 30)
    const commentByteLength = patched.readUInt16LE(centralOffset + 32)
    const nameOffset = centralOffset + 46
    if (patched.subarray(nameOffset, nameOffset + nameByteLength).equals(source)) {
      target.copy(patched, nameOffset)
      centralReplacements += 1
    }
    centralOffset = nameOffset + nameByteLength + extraByteLength + commentByteLength
  }

  assert.equal(localReplacements, 1, 'fixture ZIP must contain one matching local entry')
  assert.equal(centralReplacements, 1, 'fixture ZIP must contain one matching central entry')
  return patched
}

async function assertInvalidArchiveCause(packagedArtifact, causePattern) {
  await assert.rejects(verifyPackagedArchive(packagedArtifact), (error) => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /archive is not a valid ZIP/u)
    assert.ok(error.cause instanceof Error)
    assert.match(error.cause.message, causePattern)
    return true
  })
}

async function createFixtureArtifact(
  outputRoot,
  {
    includeOracle = true,
    modelBytes = Buffer.from([1, 2, 3, 4]),
    archiveEntries = {},
    transformArchiveBytes = (bytes) => bytes,
  } = {},
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
    version: '0.1.1',
    modelDelivery: 'packaged',
    fixture: true,
    model,
    files,
  }
  const archiveName = 'hv-pony-solver-chromium-packaged-fixture-0.1.1.zip'
  const archiveBytes = Buffer.from(
    transformArchiveBytes(
      Buffer.from(
        zipSync({
          ...sourceFiles,
          'build-manifest.json': jsonBytes(buildManifest),
          ...archiveEntries,
        }),
      ),
    ),
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

test('archive verification rejects unsafe entry paths before extraction', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-packaged-unsafe-path-'))
  context.after(() => rm(outputRoot, { recursive: true, force: true }))
  await createFixtureArtifact(outputRoot, {
    archiveEntries: { '../escape.js': Buffer.from('escape') },
  })
  const packagedArtifact = await discoverPackagedArtifact(outputRoot, 'chromium')

  await assertInvalidArchiveCause(packagedArtifact, /unsafe path/u)
})

test('archive verification rejects undeclared entries before extraction', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-packaged-unexpected-entry-'))
  context.after(() => rm(outputRoot, { recursive: true, force: true }))
  await createFixtureArtifact(outputRoot, {
    archiveEntries: { 'unexpected.js': Buffer.from('unexpected') },
  })
  const packagedArtifact = await discoverPackagedArtifact(outputRoot, 'chromium')

  await assertInvalidArchiveCause(packagedArtifact, /unexpected entry/u)
})

test('archive verification rejects duplicate entries before extraction', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-packaged-duplicate-entry-'))
  context.after(() => rm(outputRoot, { recursive: true, force: true }))
  await createFixtureArtifact(outputRoot, {
    archiveEntries: { 'aaaaaaaaaa.js': Buffer.from('duplicate') },
    transformArchiveBytes: (bytes) => replaceArchiveEntryName(bytes, 'aaaaaaaaaa.js', 'background.js'),
  })
  const packagedArtifact = await discoverPackagedArtifact(outputRoot, 'chromium')

  await assertInvalidArchiveCause(packagedArtifact, /duplicate entry/u)
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
