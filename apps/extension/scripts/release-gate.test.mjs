import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { URL } from 'node:url'

import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'

import { createCanonicalAttestation, validateFirefoxAndroidEvidence, validateReleaseGate } from './release-gate.mjs'

const model = {
  filename: ORT_MODEL_FILENAME,
  byteLength: ORT_MODEL_INTEGRITY.byteLength,
  sha256: ORT_MODEL_INTEGRITY.sha256,
}
const archiveHashes = {
  chromium: '1'.repeat(64),
  firefox: '2'.repeat(64),
}

function artifact(target, overrides = {}) {
  return {
    target,
    modelDelivery: 'packaged',
    model,
    archive: {
      archiveName: `hv-pony-solver-${target}-packaged-0.1.0.zip`,
      byteLength: 100,
      sha256: archiveHashes[target],
    },
    files: {
      [`model/${model.filename}`]: {
        byteLength: model.byteLength,
        sha256: model.sha256,
      },
    },
    ...overrides,
  }
}

function successfulInference(runCount = 2) {
  return {
    randomFallback: false,
    runCount,
    results: Array.from({ length: runCount }, () => ({
      type: 'success',
      classId: 0,
      answerCode: 'TS',
      confidence: 0.95,
      checkedIndexes: [0],
    })),
  }
}

function evidence(target, overrides = {}) {
  return {
    schemaVersion: 2,
    kind: 'packaged-browser-e2e',
    target,
    passed: true,
    fixture: false,
    model,
    archive: artifact(target).archive,
    tree: { fileCount: 12, sha256: '3'.repeat(64) },
    inference: successfulInference(),
    browserVersion: target === 'firefox' ? '140.0.4' : '116.0.5845.96',
    ...(target === 'firefox' ? { driverVersion: '0.37.1' } : {}),
    ...overrides,
  }
}

function androidEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'firefox-android-142-packaged-e2e',
    target: 'firefox-android',
    passed: true,
    browserVersion: '142.0',
    device: { model: 'Android Emulator', androidVersion: '16' },
    model,
    archive: artifact('firefox').archive,
    inference: successfulInference(1),
    ...overrides,
  }
}

const environment = {
  PACKAGED_MODEL_URL: 'https://models.example/canonical.ort',
  PACKAGED_MODEL_AUTH_REQUIRED: 'false',
}

function validGateInputs() {
  const artifacts = [artifact('chromium'), artifact('firefox')]
  const attestation = createCanonicalAttestation({
    chromium: evidence('chromium'),
    firefox: evidence('firefox'),
  })
  return { androidEvidence: androidEvidence(), artifacts, attestation, environment }
}

test('publication accepts exact canonical artifacts plus desktop and Android inference evidence', () => {
  assert.equal(validateReleaseGate(validGateInputs()), true)
})

test('fixture build is test-only and never publishable', () => {
  const inputs = validGateInputs()
  inputs.artifacts[0] = artifact('chromium', { fixture: true })
  assert.throws(() => validateReleaseGate(inputs), /fixture artifact/u)
  assert.throws(
    () =>
      createCanonicalAttestation({
        chromium: evidence('chromium', { fixture: true }),
        firefox: evidence('firefox'),
      }),
    /fixture E2E evidence/u,
  )
})

test('desktop evidence must use schema 2 and bind the complete tested archive', () => {
  assert.throws(
    () =>
      createCanonicalAttestation({
        chromium: evidence('chromium', { schemaVersion: 1 }),
        firefox: evidence('firefox'),
      }),
    /absent or invalid/u,
  )
  const inputs = validGateInputs()
  inputs.attestation.targets.chromium.archive = {
    ...inputs.attestation.targets.chromium.archive,
    byteLength: 101,
  }
  assert.throws(() => validateReleaseGate(inputs), /does not match the release archive byteLength/u)
})

test('Firefox Android evidence is mandatory, exact-major, and archive-bound', () => {
  const firefoxArtifact = artifact('firefox')
  assert.equal(validateFirefoxAndroidEvidence(androidEvidence(), firefoxArtifact), true)
  assert.throws(() => validateFirefoxAndroidEvidence(undefined, firefoxArtifact), /absent or invalid/u)
  assert.throws(
    () => validateFirefoxAndroidEvidence(androidEvidence({ browserVersion: '143.0' }), firefoxArtifact),
    /not the executable minimum major 142/u,
  )
  assert.throws(
    () =>
      validateFirefoxAndroidEvidence(
        androidEvidence({
          archive: { ...firefoxArtifact.archive, sha256: '4'.repeat(64) },
        }),
        firefoxArtifact,
      ),
    /does not match the release archive sha256/u,
  )
  const inputs = validGateInputs()
  inputs.androidEvidence = undefined
  assert.throws(() => validateReleaseGate(inputs), /Android 142 E2E evidence is absent/u)
})

test('publication requires canonical secret policy and exact provenance', () => {
  for (const [changedEnvironment, error] of [
    [{}, /PACKAGED_MODEL_URL is required/u],
    [{ PACKAGED_MODEL_URL: 'http://models.example/model.ort' }, /must use HTTPS/u],
    [
      {
        PACKAGED_MODEL_URL: environment.PACKAGED_MODEL_URL,
        PACKAGED_MODEL_AUTH_REQUIRED: 'true',
      },
      /PACKAGED_MODEL_BEARER_TOKEN is required/u,
    ],
  ]) {
    const inputs = validGateInputs()
    inputs.environment = changedEnvironment
    assert.throws(() => validateReleaseGate(inputs), error)
  }
  const wrongModelInputs = validGateInputs()
  wrongModelInputs.artifacts[0] = artifact('chromium', { model: { ...model, byteLength: 1 } })
  assert.throws(() => validateReleaseGate(wrongModelInputs), /wrong canonical model byteLength/u)
  const absentInputs = validGateInputs()
  absentInputs.attestation = null
  assert.throws(() => validateReleaseGate(absentInputs), /attestation is absent/u)
})

test('CLI preflight hashes archives and requires external Android evidence', async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-release-gate-'))
  context.after(() => rm(outputRoot, { recursive: true, force: true }))
  const records = []
  for (const target of ['chromium', 'firefox']) {
    const archiveName = `hv-pony-solver-${target}-packaged-0.1.0.zip`
    const archiveBytes = Buffer.from(`${target}-archive`)
    const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex')
    const record = artifact(target, {
      archive: { archiveName, byteLength: archiveBytes.byteLength, sha256: archiveSha256 },
    })
    records.push(record)
    await Promise.all([
      writeFile(path.join(outputRoot, `${target}.artifact.json`), `${JSON.stringify(record)}\n`),
      writeFile(path.join(outputRoot, archiveName), archiveBytes),
      writeFile(path.join(outputRoot, `${archiveName}.sha256`), `${archiveSha256}  ${archiveName}\n`),
    ])
  }
  const attestation = createCanonicalAttestation({
    chromium: evidence('chromium', { archive: records[0].archive }),
    firefox: evidence('firefox', { archive: records[1].archive }),
  })
  await Promise.all([
    writeFile(path.join(outputRoot, 'canonical-gate-attestation.json'), `${JSON.stringify(attestation)}\n`),
    writeFile(
      path.join(outputRoot, 'firefox-android-142-evidence.json'),
      `${JSON.stringify(androidEvidence({ archive: records[1].archive }))}\n`,
    ),
  ])
  const environmentOverrides = {
    ...process.env,
    PACKAGED_MODEL_URL: environment.PACKAGED_MODEL_URL,
    PACKAGED_MODEL_AUTH_REQUIRED: 'false',
  }
  const run = () =>
    spawnSync(process.execPath, ['scripts/release-gate.mjs', 'preflight', '--output-root', outputRoot], {
      cwd: new URL('..', import.meta.url),
      env: environmentOverrides,
      encoding: 'utf8',
    })
  assert.equal(run().status, 0)

  await writeFile(path.join(outputRoot, records[0].archive.archiveName), 'tampered archive')
  const tampered = run()
  assert.equal(tampered.status, 1)
  assert.match(tampered.stderr, /archive bytes do not match artifact metadata/u)
})
