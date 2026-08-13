import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import test from 'node:test'

import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'

import { createCanonicalAttestation, validateReleaseGate } from './release-gate.mjs'

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

function evidence(target, overrides = {}) {
  return {
    schemaVersion: 1,
    target,
    passed: true,
    fixture: false,
    model,
    archive: artifact(target).archive,
    browserVersion: target === 'firefox' ? '153.0' : '140.0',
    ...overrides,
  }
}

const environment = {
  PACKAGED_MODEL_URL: 'https://models.example/canonical.ort',
  PACKAGED_MODEL_AUTH_REQUIRED: 'false',
}

test('publication accepts only exact canonical artifacts with both E2E attestations', () => {
  const artifacts = [artifact('chromium'), artifact('firefox')]
  const attestation = createCanonicalAttestation({
    chromium: evidence('chromium'),
    firefox: evidence('firefox', { driverVersion: '0.37.1' }),
  })
  assert.equal(validateReleaseGate({ artifacts, attestation, environment }), true)
})

test('fixture build is test-only and never publishable', () => {
  const artifacts = [artifact('chromium', { fixture: true }), artifact('firefox')]
  const attestation = createCanonicalAttestation({ chromium: evidence('chromium'), firefox: evidence('firefox') })
  assert.throws(() => validateReleaseGate({ artifacts, attestation, environment }), /fixture artifact/u)
  assert.throws(
    () => createCanonicalAttestation({
      chromium: evidence('chromium', { fixture: true }),
      firefox: evidence('firefox'),
    }),
    /fixture E2E evidence/u,
  )
})

test('publication requires canonical secret policy and exact provenance', () => {
  const artifacts = [artifact('chromium'), artifact('firefox')]
  const attestation = createCanonicalAttestation({ chromium: evidence('chromium'), firefox: evidence('firefox') })
  for (const [changedEnvironment, error] of [
    [{}, /PACKAGED_MODEL_URL is required/u],
    [{ PACKAGED_MODEL_URL: 'http://models.example/model.ort' }, /must use HTTPS/u],
    [{
      PACKAGED_MODEL_URL: environment.PACKAGED_MODEL_URL,
      PACKAGED_MODEL_AUTH_REQUIRED: 'true',
    }, /PACKAGED_MODEL_BEARER_TOKEN is required/u],
  ]) {
    assert.throws(() => validateReleaseGate({ artifacts, attestation, environment: changedEnvironment }), error)
  }
  assert.throws(
    () => validateReleaseGate({
      artifacts: [artifact('chromium', { model: { ...model, byteLength: 1 } }), artifact('firefox')],
      attestation,
      environment,
    }),
    /wrong canonical model byteLength/u,
  )
  assert.throws(
    () => validateReleaseGate({ artifacts, attestation: null, environment }),
    /attestation is absent/u,
  )
  assert.throws(
    () => validateReleaseGate({
      artifacts,
      attestation: {
        ...attestation,
        targets: { ...attestation.targets, firefox: { passed: false } },
      },
      environment,
    }),
    /firefox canonical packaged E2E gate did not pass/u,
  )
})

test('CLI preflight hashes archive bytes and exact checksum sidecars before trusting metadata', async (context) => {
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
  await writeFile(path.join(outputRoot, 'canonical-gate-attestation.json'), `${JSON.stringify(attestation)}\n`)
  const environmentOverrides = {
    ...process.env,
    PACKAGED_MODEL_URL: environment.PACKAGED_MODEL_URL,
    PACKAGED_MODEL_AUTH_REQUIRED: 'false',
  }
  const run = () => spawnSync(
    process.execPath,
    ['scripts/release-gate.mjs', 'preflight', '--output-root', outputRoot],
    { cwd: new URL('..', import.meta.url), env: environmentOverrides, encoding: 'utf8' },
  )
  assert.equal(run().status, 0)

  await writeFile(path.join(outputRoot, records[0].archive.archiveName), 'tampered archive')
  const tampered = run()
  assert.equal(tampered.status, 1)
  assert.match(tampered.stderr, /archive bytes do not match artifact metadata/u)
})
