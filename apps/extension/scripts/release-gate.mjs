import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ANSWER_CODES } from '@hv-pony-solver/shared/answer'
import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'

import { assertExactMinimumBrowserVersion, assertSupportedBrowserVersion } from './browser-support.mjs'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const canonicalIdentity = Object.freeze({
  filename: ORT_MODEL_FILENAME,
  byteLength: ORT_MODEL_INTEGRITY.byteLength,
  sha256: ORT_MODEL_INTEGRITY.sha256,
})
const requiredTargets = ['chromium', 'firefox']

function assertExactCanonicalIdentity(identity, label) {
  for (const key of ['filename', 'byteLength', 'sha256']) {
    if (identity?.[key] !== canonicalIdentity[key]) {
      throw new Error(`${label} has the wrong canonical model ${key}`)
    }
  }
}

function assertArchiveIdentity(identity, label) {
  if (
    typeof identity?.archiveName !== 'string' ||
    !/^[A-Za-z0-9._-]+\.zip$/u.test(identity.archiveName) ||
    !Number.isSafeInteger(identity.byteLength) ||
    identity.byteLength < 1 ||
    !/^[a-f0-9]{64}$/u.test(identity.sha256 ?? '')
  ) {
    throw new Error(`${label} archive identity is invalid`)
  }
}

function assertSameArchive(actual, expected, label) {
  assertArchiveIdentity(actual, label)
  assertArchiveIdentity(expected, `${label} artifact`)
  for (const key of ['archiveName', 'byteLength', 'sha256']) {
    if (actual[key] !== expected[key]) {
      throw new Error(`${label} does not match the release archive ${key}`)
    }
  }
}

function assertInferenceEvidence(record, label, minimumRuns) {
  const inference = record?.inference
  if (inference?.randomFallback !== false) {
    throw new Error(`${label} did not prove random fallback was disabled`)
  }
  if (
    !Number.isSafeInteger(inference.runCount) ||
    inference.runCount < minimumRuns ||
    !Array.isArray(inference.results) ||
    inference.results.length !== inference.runCount
  ) {
    throw new Error(`${label} has invalid inference run evidence`)
  }
  for (const result of inference.results) {
    if (
      result?.type !== 'success' ||
      !Number.isSafeInteger(result.classId) ||
      result.classId < 0 ||
      result.classId > 5 ||
      result.answerCode !== ANSWER_CODES[result.classId] ||
      !Number.isFinite(result.confidence) ||
      result.confidence < 0 ||
      result.confidence > 1 ||
      !Array.isArray(result.checkedIndexes) ||
      result.checkedIndexes.length !== 1 ||
      result.checkedIndexes[0] !== result.classId
    ) {
      throw new Error(`${label} has an invalid successful inference observation`)
    }
  }
}

function validateCanonicalBrowserEvidence(record, target) {
  const label = `${target} E2E evidence`
  if (
    record?.schemaVersion !== 2 ||
    record?.kind !== 'packaged-browser-e2e' ||
    record?.target !== target ||
    record?.passed !== true
  ) {
    throw new Error(`${target} packaged E2E evidence is absent or invalid`)
  }
  if (record.fixture === true || Object.hasOwn(record, 'oracle')) {
    throw new Error(`${target} fixture E2E evidence cannot attest a canonical release`)
  }
  assertExactCanonicalIdentity(record.model, label)
  assertArchiveIdentity(record.archive, label)
  if (!/^[a-f0-9]{64}$/u.test(record.tree?.sha256 ?? '') || record.tree?.fileCount < 1) {
    throw new Error(`${label} has no verified extracted-tree identity`)
  }
  assertSupportedBrowserVersion(target, record.browserVersion)
  if (target === 'firefox' && typeof record.driverVersion !== 'string') {
    throw new Error('firefox E2E evidence has no driver version')
  }
  assertInferenceEvidence(record, label, 2)
  return record
}

export function validateFirefoxAndroidEvidence(record, firefoxArtifact) {
  const label = 'Firefox Android 142 E2E evidence'
  if (
    record?.schemaVersion !== 1 ||
    record?.kind !== 'firefox-android-142-packaged-e2e' ||
    record?.target !== 'firefox-android' ||
    record?.passed !== true
  ) {
    throw new Error(`${label} is absent or invalid`)
  }
  assertExactMinimumBrowserVersion('firefox-android', record.browserVersion)
  if (
    typeof record.device?.model !== 'string' ||
    record.device.model.trim() === '' ||
    typeof record.device?.androidVersion !== 'string' ||
    record.device.androidVersion.trim() === ''
  ) {
    throw new Error(`${label} has no physical/emulated device identity`)
  }
  assertExactCanonicalIdentity(record.model, label)
  assertSameArchive(record.archive, firefoxArtifact?.archive, label)
  assertInferenceEvidence(record, label, 1)
  return true
}

function assertCanonicalEnvironment(environment) {
  if (!environment.PACKAGED_MODEL_URL) {
    throw new Error('PACKAGED_MODEL_URL is required for publication')
  }
  let url
  try {
    url = new globalThis.URL(environment.PACKAGED_MODEL_URL)
  } catch (error) {
    throw new Error('PACKAGED_MODEL_URL is invalid', { cause: error })
  }
  if (url.protocol !== 'https:') {
    throw new Error('PACKAGED_MODEL_URL must use HTTPS')
  }
  const authenticationRequired = environment.PACKAGED_MODEL_AUTH_REQUIRED === 'true'
  if (
    environment.PACKAGED_MODEL_AUTH_REQUIRED !== undefined &&
    !['true', 'false'].includes(environment.PACKAGED_MODEL_AUTH_REQUIRED)
  ) {
    throw new Error('PACKAGED_MODEL_AUTH_REQUIRED must be true or false')
  }
  if (authenticationRequired && !environment.PACKAGED_MODEL_BEARER_TOKEN) {
    throw new Error('PACKAGED_MODEL_BEARER_TOKEN is required for publication')
  }
}

export function validateReleaseGate({ artifacts, attestation, androidEvidence, environment = process.env }) {
  assertCanonicalEnvironment(environment)
  if (!Array.isArray(artifacts) || artifacts.length !== requiredTargets.length) {
    throw new Error('Publication requires exactly two canonical packaged artifacts')
  }
  const artifactsByTarget = new Map()
  for (const artifact of artifacts) {
    if (!requiredTargets.includes(artifact?.target) || artifactsByTarget.has(artifact.target)) {
      throw new Error('Publication artifacts must contain one Chromium and one Firefox target')
    }
    if (artifact.fixture === true || Object.hasOwn(artifact, 'fixture')) {
      throw new Error(`${artifact.target} fixture artifact is not publishable`)
    }
    if (artifact.modelDelivery !== 'packaged') {
      throw new Error(`${artifact.target} publication artifact is not packaged-model output`)
    }
    assertExactCanonicalIdentity(artifact.model, `${artifact.target} artifact`)
    const modelFile = artifact.files?.[`model/${canonicalIdentity.filename}`]
    if (modelFile?.byteLength !== canonicalIdentity.byteLength || modelFile?.sha256 !== canonicalIdentity.sha256) {
      throw new Error(`${artifact.target} artifact files do not attest the canonical model`)
    }
    assertArchiveIdentity(artifact.archive, `${artifact.target} artifact`)
    artifactsByTarget.set(artifact.target, artifact)
  }

  if (attestation?.schemaVersion !== 2 || attestation?.kind !== 'canonical-packaged-e2e') {
    throw new Error('Canonical packaged E2E attestation is absent or invalid')
  }
  assertExactCanonicalIdentity(attestation.model, 'Canonical E2E attestation')
  for (const target of requiredTargets) {
    const targetAttestation = attestation.targets?.[target]
    const artifact = artifactsByTarget.get(target)
    if (
      targetAttestation?.passed !== true ||
      targetAttestation?.inferenceValidated !== true ||
      !/^[a-f0-9]{64}$/u.test(targetAttestation?.treeSha256 ?? '') ||
      (target === 'firefox' && typeof targetAttestation?.driverVersion !== 'string')
    ) {
      throw new Error(`${target} canonical packaged E2E gate did not pass for this artifact`)
    }
    assertSameArchive(targetAttestation.archive, artifact.archive, `${target} canonical packaged E2E gate`)
    assertSupportedBrowserVersion(target, targetAttestation.browserVersion)
  }
  validateFirefoxAndroidEvidence(androidEvidence, artifactsByTarget.get('firefox'))
  return true
}

export function createCanonicalAttestation(evidence) {
  const targets = {}
  for (const target of requiredTargets) {
    const record = validateCanonicalBrowserEvidence(evidence?.[target], target)
    targets[target] = {
      passed: true,
      inferenceValidated: true,
      archive: { ...record.archive },
      treeSha256: record.tree.sha256,
      browserVersion: record.browserVersion,
      ...(record.driverVersion ? { driverVersion: record.driverVersion } : {}),
    }
  }
  return {
    schemaVersion: 2,
    kind: 'canonical-packaged-e2e',
    model: { ...canonicalIdentity },
    targets,
  }
}

async function discoverArtifacts(outputRoot) {
  const artifacts = []
  for (const name of (await readdir(outputRoot)).filter((entry) => entry.endsWith('.artifact.json')).sort()) {
    const artifact = JSON.parse(await readFile(path.join(outputRoot, name), 'utf8'))
    if (requiredTargets.includes(artifact.target) && artifact.modelDelivery === 'packaged') {
      const archiveName = artifact.archive?.archiveName
      if (!archiveName || path.basename(archiveName) !== archiveName) {
        throw new Error(`${artifact.target} artifact archive path is invalid`)
      }
      const archivePath = path.join(outputRoot, archiveName)
      const archiveBytes = await readFile(archivePath)
      const actualArchiveSha256 = createHash('sha256').update(archiveBytes).digest('hex')
      if (archiveBytes.byteLength !== artifact.archive.byteLength || actualArchiveSha256 !== artifact.archive.sha256) {
        throw new Error(`${artifact.target} archive bytes do not match artifact metadata`)
      }
      const sidecar = (await readFile(`${archivePath}.sha256`, 'utf8')).trim()
      const expectedSidecar = `${actualArchiveSha256}  ${archiveName}`
      if (sidecar !== expectedSidecar) {
        throw new Error(`${artifact.target} archive checksum sidecar is invalid`)
      }
      artifacts.push(artifact)
    }
  }
  return artifacts
}

function parseArguments(args) {
  const command = args.shift()
  if (!['attest', 'preflight'].includes(command)) {
    throw new Error(
      'Usage: release-gate.mjs attest|preflight [--output-root PATH] [--evidence-dir PATH] [--attestation PATH] [--android-evidence PATH]',
    )
  }
  const options = {
    command,
    outputRoot: path.join(extensionRoot, 'dist'),
  }
  while (args.length > 0) {
    const option = args.shift()
    const value = args.shift()
    if (!value || !['--output-root', '--evidence-dir', '--attestation', '--android-evidence'].includes(option)) {
      throw new Error(`Invalid release gate argument: ${option ?? ''}`)
    }
    const key = {
      '--output-root': 'outputRoot',
      '--evidence-dir': 'evidenceDir',
      '--attestation': 'attestationPath',
      '--android-evidence': 'androidEvidencePath',
    }[option]
    options[key] = path.resolve(value)
  }
  options.outputRoot = path.resolve(options.outputRoot)
  options.evidenceDir ??= path.join(options.outputRoot, 'canonical-e2e-evidence')
  options.attestationPath ??= path.join(options.outputRoot, 'canonical-gate-attestation.json')
  options.androidEvidencePath ??= path.join(options.outputRoot, 'firefox-android-142-evidence.json')
  return options
}

async function run(args) {
  const options = parseArguments([...args])
  if (options.command === 'attest') {
    const evidence = Object.fromEntries(
      await Promise.all(
        requiredTargets.map(async (target) => [
          target,
          JSON.parse(await readFile(path.join(options.evidenceDir, `${target}.json`), 'utf8')),
        ]),
      ),
    )
    const attestation = createCanonicalAttestation(evidence)
    await writeFile(options.attestationPath, `${JSON.stringify(attestation, null, 2)}\n`)
    return
  }
  validateReleaseGate({
    artifacts: await discoverArtifacts(options.outputRoot),
    attestation: JSON.parse(await readFile(options.attestationPath, 'utf8')),
    androidEvidence: JSON.parse(await readFile(options.androidEvidencePath, 'utf8')),
  })
  process.stdout.write('Canonical extension release gate passed, including external Firefox Android 142 evidence\n')
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  await run(process.argv.slice(2))
}
