import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { URL } from 'node:url'

import { zipSync } from 'fflate'

import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'

import {
  createCanonicalAttestation,
  parseArguments,
  validateFirefoxAndroidEvidence,
  validateReleaseGate,
} from './release-gate.mjs'

const model = {
  filename: ORT_MODEL_FILENAME,
  byteLength: ORT_MODEL_INTEGRITY.byteLength,
  sha256: ORT_MODEL_INTEGRITY.sha256,
}
const archiveHashes = {
  chromium: '1'.repeat(64),
  firefox: '2'.repeat(64),
}
const packagedContentSecurityPolicy =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src 'self'"

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`)
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

async function writeTransferredArtifact(outputRoot, target, contentSecurityPolicy = packagedContentSecurityPolicy) {
  const manifestBytes = jsonBytes({
    manifest_version: 3,
    background: target === 'chromium' ? { service_worker: 'background.js' } : { scripts: ['background.js'] },
    content_security_policy: { extension_pages: contentSecurityPolicy },
  })
  const backgroundBytes = Buffer.from('globalThis.releaseFixture = true\n')
  const modelBytes = await readFile(new URL('../../../model/yolo26n-640.ort', import.meta.url))
  const sourceFiles = {
    'background.js': backgroundBytes,
    'manifest.json': manifestBytes,
    [`model/${model.filename}`]: modelBytes,
  }
  const files = Object.fromEntries(
    Object.entries(sourceFiles).map(([name, bytes]) => [
      name,
      {
        byteLength: name.startsWith('model/') ? model.byteLength : bytes.byteLength,
        sha256: name.startsWith('model/') ? model.sha256 : sha256(bytes),
      },
    ]),
  )
  const buildManifest = {
    target,
    version: '0.1.0',
    modelDelivery: 'packaged',
    model,
    files,
  }
  const archiveName = `hv-pony-solver-${target}-packaged-0.1.0.zip`
  const archiveBytes = Buffer.from(zipSync({ ...sourceFiles, 'build-manifest.json': jsonBytes(buildManifest) }))
  const archive = { archiveName, byteLength: archiveBytes.byteLength, sha256: sha256(archiveBytes) }
  const record = { ...buildManifest, archive }
  await Promise.all([
    writeFile(path.join(outputRoot, `${target}.artifact.json`), `${JSON.stringify(record)}\n`),
    writeFile(path.join(outputRoot, archiveName), archiveBytes),
    writeFile(path.join(outputRoot, `${archiveName}.sha256`), `${archive.sha256}  ${archiveName}\n`),
  ])
  return record
}

async function rewriteTransferredArchive(outputRoot, record, contentSecurityPolicy) {
  const archiveName = record.archive.archiveName
  const manifestBytes = jsonBytes({
    manifest_version: 3,
    background: record.target === 'chromium' ? { service_worker: 'background.js' } : { scripts: ['background.js'] },
    content_security_policy: { extension_pages: contentSecurityPolicy },
  })
  const modelBytes = await readFile(new URL('../../../model/yolo26n-640.ort', import.meta.url))
  const sourceFiles = {
    'background.js': Buffer.from('globalThis.releaseFixture = true\n'),
    'manifest.json': manifestBytes,
    [`model/${model.filename}`]: modelBytes,
  }
  const files = Object.fromEntries(
    Object.entries(sourceFiles).map(([name, bytes]) => [
      name,
      {
        byteLength: name.startsWith('model/') ? model.byteLength : bytes.byteLength,
        sha256: name.startsWith('model/') ? model.sha256 : sha256(bytes),
      },
    ]),
  )
  const buildManifest = { target: record.target, version: record.version, modelDelivery: 'packaged', model, files }
  const archiveBytes = Buffer.from(zipSync({ ...sourceFiles, 'build-manifest.json': jsonBytes(buildManifest) }))
  const archive = { archiveName, byteLength: archiveBytes.byteLength, sha256: sha256(archiveBytes) }
  const changedRecord = { ...buildManifest, archive }
  await Promise.all([
    writeFile(path.join(outputRoot, `${record.target}.artifact.json`), `${JSON.stringify(changedRecord)}\n`),
    writeFile(path.join(outputRoot, archiveName), archiveBytes),
    writeFile(path.join(outputRoot, `${archiveName}.sha256`), `${archive.sha256}  ${archiveName}\n`),
  ])
  return changedRecord
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
    () => validateFirefoxAndroidEvidence(androidEvidence({ fixture: true }), firefoxArtifact),
    /cannot attest a canonical release/u,
  )
  assert.throws(
    () =>
      validateFirefoxAndroidEvidence(androidEvidence({ oracle: { classId: 0, confidence: 0.95 } }), firefoxArtifact),
    /cannot attest a canonical release/u,
  )
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
      { PACKAGED_MODEL_URL: environment.PACKAGED_MODEL_URL },
      /PACKAGED_MODEL_AUTH_REQUIRED must be explicitly true or false/u,
    ],
    [
      { PACKAGED_MODEL_URL: environment.PACKAGED_MODEL_URL, PACKAGED_MODEL_AUTH_REQUIRED: '' },
      /PACKAGED_MODEL_AUTH_REQUIRED must be explicitly true or false/u,
    ],
    [
      { PACKAGED_MODEL_URL: environment.PACKAGED_MODEL_URL, PACKAGED_MODEL_AUTH_REQUIRED: 'yes' },
      /PACKAGED_MODEL_AUTH_REQUIRED must be explicitly true or false/u,
    ],
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

test('verify-monorepo pins Firefox load tooling and binds Android evidence to the release revision', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/verify-monorepo.yml', import.meta.url), 'utf8')
  const extensionJob = workflow.match(
    /\n {2}extension-e2e:\n(?<job>[\s\S]*?)\n {2}extension-remote-authenticated-e2e:/u,
  )?.groups?.job
  assert.ok(extensionJob)
  assert.match(
    extensionJob,
    /- name: Install pinned geckodriver\n\s+id: geckodriver\n\s+run: node apps\/extension\/scripts\/install-geckodriver\.mjs "\$RUNNER_TEMP\/geckodriver"/u,
  )
  assert.match(
    extensionJob,
    /- name: Firefox production remote extension load-only smoke\n\s+env:\n\s+GECKODRIVER_PATH: \$\{\{ steps\.geckodriver\.outputs\.path \}\}/u,
  )

  const androidStep = workflow.match(
    /- name: Download successful external Firefox Android 142 evidence\n(?<step>[\s\S]*?)\n\s+- name: Fail-closed desktop and Firefox Android release preflight/u,
  )?.groups?.step
  assert.ok(androidStep)
  assert.match(androidStep, /FIREFOX_ANDROID_E2E_WORKFLOW_ID: \$\{\{ vars\.FIREFOX_ANDROID_E2E_WORKFLOW_ID \}\}/u)
  assert.match(androidStep, /if \[\[ ! "\$FIREFOX_ANDROID_E2E_WORKFLOW_ID" =~ \^\[0-9\]\+\$ \]\]; then/u)
  assert.match(androidStep, /\[\.conclusion, \.head_sha, \(\.workflow_id \| tostring\), \.event\] \| @tsv/u)
  assert.match(androidStep, /if \[\[ "\$head_sha" != "\$GITHUB_SHA" \]\]; then/u)
  assert.match(androidStep, /if \[\[ "\$workflow_id" != "\$FIREFOX_ANDROID_E2E_WORKFLOW_ID" \]\]; then/u)
  assert.match(androidStep, /workflow_dispatch\|repository_dispatch\) ;;/u)
  assert.ok(androidStep.indexOf('case "$event" in') < androidStep.indexOf('gh run download'))
})

test(
  'CLI preflight verifies only the transferred, hash-bound ZIP products and rejects wrong packaged CSP',
  { skip: !existsSync(new URL('../../../model/yolo26n-640.ort', import.meta.url)) },
  async (context) => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-release-gate-'))
    context.after(() => rm(outputRoot, { recursive: true, force: true }))
    const records = await Promise.all(
      ['chromium', 'firefox'].map((target) => writeTransferredArtifact(outputRoot, target)),
    )
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
    const passed = run()
    assert.equal(passed.status, 0, passed.stderr)

    await writeFile(path.join(outputRoot, records[0].archive.archiveName), 'tampered archive')
    const tampered = run()
    assert.equal(tampered.status, 1)
    assert.match(tampered.stderr, /archive bytes do not match artifact metadata/u)

    const wrongCspRecord = await rewriteTransferredArchive(
      outputRoot,
      records[0],
      "script-src 'self'; object-src 'none'",
    )
    attestation.targets.chromium.archive = { ...wrongCspRecord.archive }
    await writeFile(path.join(outputRoot, 'canonical-gate-attestation.json'), `${JSON.stringify(attestation)}\n`)
    const wrongCsp = run()
    assert.equal(wrongCsp.status, 1)
    assert.match(wrongCsp.stderr, /packaged manifest has an unexpected extension page CSP/u)
  },
)

test('release gate CLI rejects option values that look like further options', () => {
  assert.throws(() => parseArguments(['nonsense']), /Usage: release-gate\.mjs/u)
  assert.throws(() => parseArguments(['preflight', '--evidence-dir']), /Invalid release gate argument: --evidence-dir/u)
  assert.throws(
    () => parseArguments(['preflight', '--evidence-dir', '--attestation']),
    /Invalid release gate argument: --evidence-dir/u,
  )
  assert.throws(
    () => parseArguments(['attest', '--output-root', '--android-evidence', 'evidence.json']),
    /Invalid release gate argument: --output-root/u,
  )
  const options = parseArguments(['preflight', '--output-root', 'dist-check'])
  assert.equal(options.command, 'preflight')
  assert.equal(options.outputRoot, path.resolve('dist-check'))
  assert.equal(options.evidenceDir, path.join(path.resolve('dist-check'), 'canonical-e2e-evidence'))
})
