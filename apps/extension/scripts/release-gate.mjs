import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'

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
    environment.PACKAGED_MODEL_AUTH_REQUIRED !== undefined
    && !['true', 'false'].includes(environment.PACKAGED_MODEL_AUTH_REQUIRED)
  ) {
    throw new Error('PACKAGED_MODEL_AUTH_REQUIRED must be true or false')
  }
  if (authenticationRequired && !environment.PACKAGED_MODEL_BEARER_TOKEN) {
    throw new Error('PACKAGED_MODEL_BEARER_TOKEN is required for publication')
  }
}

export function validateReleaseGate({ artifacts, attestation, environment = process.env }) {
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
    if (
      modelFile?.byteLength !== canonicalIdentity.byteLength
      || modelFile?.sha256 !== canonicalIdentity.sha256
    ) {
      throw new Error(`${artifact.target} artifact files do not attest the canonical model`)
    }
    if (!artifact.archive?.archiveName || !/^[A-Za-z0-9._-]+\.zip$/u.test(artifact.archive.archiveName)) {
      throw new Error(`${artifact.target} artifact archive identity is invalid`)
    }
    artifactsByTarget.set(artifact.target, artifact)
  }

  if (attestation?.schemaVersion !== 1 || attestation?.kind !== 'canonical-packaged-e2e') {
    throw new Error('Canonical packaged E2E attestation is absent or invalid')
  }
  assertExactCanonicalIdentity(attestation.model, 'Canonical E2E attestation')
  for (const target of requiredTargets) {
    const targetAttestation = attestation.targets?.[target]
    const artifact = artifactsByTarget.get(target)
    if (
      targetAttestation?.passed !== true
      || targetAttestation.archiveSha256 !== artifact.archive.sha256
    ) {
      throw new Error(`${target} canonical packaged E2E gate did not pass for this artifact`)
    }
  }
  return true
}

export function createCanonicalAttestation(evidence) {
  const targets = {}
  for (const target of requiredTargets) {
    const record = evidence?.[target]
    if (record?.schemaVersion !== 1 || record?.target !== target || record?.passed !== true) {
      throw new Error(`${target} packaged E2E evidence is absent or invalid`)
    }
    if (record.fixture === true) {
      throw new Error(`${target} fixture E2E evidence cannot attest a canonical release`)
    }
    assertExactCanonicalIdentity(record.model, `${target} E2E evidence`)
    if (!record.archive?.sha256) {
      throw new Error(`${target} E2E evidence has no archive hash`)
    }
    targets[target] = {
      passed: true,
      archiveSha256: record.archive.sha256,
      browserVersion: record.browserVersion,
      ...(record.driverVersion ? { driverVersion: record.driverVersion } : {}),
    }
  }
  return {
    schemaVersion: 1,
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
      if (
        archiveBytes.byteLength !== artifact.archive.byteLength
        || actualArchiveSha256 !== artifact.archive.sha256
      ) {
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
    throw new Error('Usage: release-gate.mjs attest|preflight [--output-root PATH] [--evidence-dir PATH] [--attestation PATH]')
  }
  const options = {
    command,
    outputRoot: path.join(extensionRoot, 'dist'),
  }
  while (args.length > 0) {
    const option = args.shift()
    const value = args.shift()
    if (!value || !['--output-root', '--evidence-dir', '--attestation'].includes(option)) {
      throw new Error(`Invalid release gate argument: ${option ?? ''}`)
    }
    const key = {
      '--output-root': 'outputRoot',
      '--evidence-dir': 'evidenceDir',
      '--attestation': 'attestationPath',
    }[option]
    options[key] = path.resolve(value)
  }
  options.outputRoot = path.resolve(options.outputRoot)
  options.evidenceDir ??= path.join(options.outputRoot, 'canonical-e2e-evidence')
  options.attestationPath ??= path.join(options.outputRoot, 'canonical-gate-attestation.json')
  return options
}

async function run(args) {
  const options = parseArguments([...args])
  if (options.command === 'attest') {
    const evidence = Object.fromEntries(
      await Promise.all(requiredTargets.map(async (target) => [
        target,
        JSON.parse(await readFile(path.join(options.evidenceDir, `${target}.json`), 'utf8')),
      ])),
    )
    const attestation = createCanonicalAttestation(evidence)
    await writeFile(options.attestationPath, `${JSON.stringify(attestation, null, 2)}\n`)
    return
  }
  validateReleaseGate({
    artifacts: await discoverArtifacts(options.outputRoot),
    attestation: JSON.parse(await readFile(options.attestationPath, 'utf8')),
  })
  process.stdout.write('Canonical extension release gate passed\n')
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  await run(process.argv.slice(2))
}
