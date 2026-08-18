import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { unzipSync } from 'fflate'

const packagedTargets = new Set(['chromium', 'firefox'])
const answerCount = 6

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function assertFileIdentity(identity, label) {
  assertPlainObject(identity, label)
  if (!Number.isSafeInteger(identity.byteLength) || identity.byteLength < 0) {
    throw new Error(`${label} has an invalid byte length`)
  }
  if (!/^[a-f0-9]{64}$/u.test(identity.sha256 ?? '')) {
    throw new Error(`${label} has an invalid SHA-256`)
  }
}

function assertSafeArchiveName(name, label) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.includes('\\') ||
    name.includes('\0') ||
    path.posix.isAbsolute(name) ||
    path.posix.normalize(name) !== name ||
    name.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`${label} has an unsafe path: ${String(name)}`)
  }
}

export function validatePackagedOracle(value, label = 'Packaged fixture oracle') {
  assertPlainObject(value, label)
  if (!isDeepStrictEqual(Object.keys(value).sort(), ['classId', 'confidence'])) {
    throw new Error(`${label} must contain exactly classId and confidence`)
  }
  if (!Number.isSafeInteger(value.classId) || value.classId < 0 || value.classId >= answerCount) {
    throw new Error(`${label} has an invalid classId`)
  }
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error(`${label} has an invalid confidence`)
  }
  return { classId: value.classId, confidence: value.confidence }
}

function validatePackagedArtifact(artifact, target, label) {
  assertPlainObject(artifact, label)
  if (artifact.target !== target || !packagedTargets.has(artifact.target)) {
    throw new Error(`${label} has the wrong target`)
  }
  if (artifact.modelDelivery !== 'packaged') {
    throw new Error(`${label} is not a packaged-model artifact`)
  }
  if (typeof artifact.version !== 'string' || artifact.version.length === 0) {
    throw new Error(`${label} has an invalid version`)
  }
  if (artifact.fixture !== true && Object.hasOwn(artifact, 'fixture')) {
    throw new Error(`${label} has an invalid fixture marker`)
  }

  assertPlainObject(artifact.model, `${label} model`)
  if (!/^[A-Za-z0-9._-]+\.ort$/u.test(artifact.model.filename ?? '')) {
    throw new Error(`${label} model has an invalid filename`)
  }
  assertFileIdentity(artifact.model, `${label} model`)
  const oracle =
    artifact.fixture === true
      ? validatePackagedOracle(artifact.model.expected, `${label} fixture oracle`)
      : artifact.model.expected === undefined
        ? null
        : validatePackagedOracle(artifact.model.expected, `${label} oracle`)

  assertPlainObject(artifact.archive, `${label} archive`)
  if (
    typeof artifact.archive.archiveName !== 'string' ||
    path.basename(artifact.archive.archiveName) !== artifact.archive.archiveName ||
    !/^[A-Za-z0-9._-]+\.zip$/u.test(artifact.archive.archiveName)
  ) {
    throw new Error(`${label} archive has an invalid filename`)
  }
  assertFileIdentity(artifact.archive, `${label} archive`)

  assertPlainObject(artifact.files, `${label} files`)
  if (Object.hasOwn(artifact.files, 'build-manifest.json')) {
    throw new Error(`${label} files must not self-attest build-manifest.json`)
  }
  for (const [name, identity] of Object.entries(artifact.files)) {
    assertSafeArchiveName(name, `${label} file`)
    assertFileIdentity(identity, `${label} file ${name}`)
  }
  const modelPath = `model/${artifact.model.filename}`
  if (
    !isDeepStrictEqual(artifact.files[modelPath], {
      byteLength: artifact.model.byteLength,
      sha256: artifact.model.sha256,
    })
  ) {
    throw new Error(`${label} does not attest its packaged model file`)
  }
  if (Object.keys(artifact.files).filter((name) => name.endsWith('.ort')).length !== 1) {
    throw new Error(`${label} must attest exactly one ORT model`)
  }
  return oracle
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error })
  }
}

function assertMetadataMatch(artifact, buildManifest, oracle, label) {
  assertPlainObject(buildManifest, `${label} build manifest`)
  for (const key of ['target', 'version', 'modelDelivery']) {
    if (buildManifest[key] !== artifact[key]) {
      throw new Error(`${label} build manifest ${key} does not match artifact metadata`)
    }
  }
  if (buildManifest.fixture !== artifact.fixture) {
    throw new Error(`${label} build manifest fixture marker does not match artifact metadata`)
  }
  if (!isDeepStrictEqual(buildManifest.model, artifact.model)) {
    throw new Error(`${label} build manifest model does not match artifact metadata`)
  }
  if (!isDeepStrictEqual(buildManifest.files, artifact.files)) {
    throw new Error(`${label} build manifest files do not match artifact metadata`)
  }
  if (artifact.fixture === true) {
    const manifestOracle = validatePackagedOracle(
      buildManifest.model?.expected,
      `${label} build manifest fixture oracle`,
    )
    if (!isDeepStrictEqual(manifestOracle, oracle)) {
      throw new Error(`${label} build manifest fixture oracle does not match artifact metadata`)
    }
  }
}

function verifyArchiveEntries(packagedArtifact, entries, actualArchive) {
  const { artifact, target } = packagedArtifact
  const label = `${target} packaged archive`
  const names = Object.keys(entries).sort()
  for (const name of names) {
    assertSafeArchiveName(name, `${label} entry`)
  }
  const expectedNames = [...Object.keys(artifact.files), 'build-manifest.json'].sort()
  if (!isDeepStrictEqual(names, expectedNames)) {
    throw new Error(`${label} tree does not match artifact metadata`)
  }

  const fileRecords = {}
  for (const name of names) {
    const bytes = entries[name]
    if (!(bytes instanceof Uint8Array)) {
      throw new Error(`${label} entry ${name} is not a file`)
    }
    const identity = { byteLength: bytes.byteLength, sha256: sha256(bytes) }
    fileRecords[name] = identity
    if (name !== 'build-manifest.json' && !isDeepStrictEqual(identity, artifact.files[name])) {
      throw new Error(`${label} entry ${name} does not match artifact metadata`)
    }
  }

  const buildManifest = parseJsonBytes(entries['build-manifest.json'], `${label} build-manifest.json`)
  assertMetadataMatch(artifact, buildManifest, packagedArtifact.oracle, label)
  const manifest = parseJsonBytes(entries['manifest.json'], `${label} manifest.json`)
  if (manifest.manifest_version !== 3) {
    throw new Error(`${label} manifest is not MV3`)
  }
  if (target === 'chromium' && manifest.background?.service_worker !== 'background.js') {
    throw new Error(`${label} manifest does not declare the Chromium service worker`)
  }
  if (target === 'firefox' && !isDeepStrictEqual(manifest.background?.scripts, ['background.js'])) {
    throw new Error(`${label} manifest does not declare the Firefox background script`)
  }
  if (manifest.host_permissions?.includes('https://models.ngnl.host/*')) {
    throw new Error(`${label} manifest unexpectedly permits the remote model host`)
  }
  if (Object.hasOwn(manifest, 'web_accessible_resources')) {
    throw new Error(`${label} manifest exposes web-accessible resources`)
  }

  return {
    target,
    archive: actualArchive,
    model: { ...artifact.model },
    oracle: packagedArtifact.oracle ? { ...packagedArtifact.oracle } : null,
    buildManifest,
    manifest,
    files: fileRecords,
    tree: {
      fileCount: names.length,
      sha256: sha256(Buffer.from(JSON.stringify(fileRecords))),
    },
  }
}

async function readAndVerifyPackagedArchive(packagedArtifact) {
  const archiveBytes = await readFile(packagedArtifact.archivePath)
  const actualArchive = {
    archiveName: path.basename(packagedArtifact.archivePath),
    byteLength: archiveBytes.byteLength,
    sha256: sha256(archiveBytes),
  }
  if (!isDeepStrictEqual(actualArchive, packagedArtifact.artifact.archive)) {
    throw new Error(`${packagedArtifact.target} archive bytes do not match artifact metadata`)
  }
  const sidecar = (await readFile(`${packagedArtifact.archivePath}.sha256`, 'utf8')).trim()
  if (sidecar !== `${actualArchive.sha256}  ${actualArchive.archiveName}`) {
    throw new Error(`${packagedArtifact.target} archive checksum sidecar is invalid`)
  }

  let entries
  try {
    entries = unzipSync(new Uint8Array(archiveBytes))
  } catch (error) {
    throw new Error(`${packagedArtifact.target} archive is not a valid ZIP`, { cause: error })
  }
  return {
    entries,
    verification: verifyArchiveEntries(packagedArtifact, entries, actualArchive),
  }
}

export async function discoverPackagedArtifact(outputRoot, target) {
  if (!packagedTargets.has(target)) {
    throw new Error(`Unsupported packaged artifact target: ${target}`)
  }
  const artifactCandidates = (await readdir(outputRoot)).filter((name) => name.endsWith('.artifact.json')).sort()
  const matchingArtifacts = []
  for (const name of artifactCandidates) {
    const artifactPath = path.join(outputRoot, name)
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8'))
    if (artifact.target === target && artifact.modelDelivery === 'packaged') {
      const oracle = validatePackagedArtifact(artifact, target, name)
      matchingArtifacts.push({ artifact, artifactPath, oracle })
    }
  }
  if (matchingArtifacts.length !== 1) {
    throw new Error(`Expected one ${target} packaged artifact metadata file, found ${matchingArtifacts.length}`)
  }
  const [{ artifact, artifactPath, oracle }] = matchingArtifacts
  return {
    target,
    archivePath: path.join(outputRoot, artifact.archive.archiveName),
    artifact,
    artifactPath,
    modelPath: path.join(outputRoot, target, 'model', artifact.model.filename),
    oracle,
    outputRoot,
    targetDirectory: path.join(outputRoot, target),
  }
}

export async function verifyPackagedArchive(packagedArtifact) {
  return (await readAndVerifyPackagedArchive(packagedArtifact)).verification
}

async function walkExtractedFiles(root, current = root) {
  const files = []
  for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const absolutePath = path.join(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkExtractedFiles(root, absolutePath)))
    } else if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: path.relative(root, absolutePath).split(path.sep).join('/'),
      })
    } else {
      throw new Error(`Extracted packaged tree contains a non-file entry: ${absolutePath}`)
    }
  }
  return files
}

export async function verifyExtractedPackagedTree(root, verification) {
  const files = await walkExtractedFiles(root)
  const records = {}
  for (const file of files) {
    const bytes = await readFile(file.absolutePath)
    records[file.relativePath] = { byteLength: bytes.byteLength, sha256: sha256(bytes) }
  }
  if (!isDeepStrictEqual(records, verification.files)) {
    throw new Error(`${verification.target} extracted packaged tree does not match the tested archive`)
  }
  const [buildManifest, manifest, modelBytes] = await Promise.all([
    readFile(path.join(root, 'build-manifest.json')).then((bytes) =>
      parseJsonBytes(bytes, `${verification.target} extracted build-manifest.json`),
    ),
    readFile(path.join(root, 'manifest.json')).then((bytes) =>
      parseJsonBytes(bytes, `${verification.target} extracted manifest.json`),
    ),
    readFile(path.join(root, 'model', verification.model.filename)),
  ])
  if (!isDeepStrictEqual(buildManifest, verification.buildManifest)) {
    throw new Error(`${verification.target} extracted build manifest changed after ZIP verification`)
  }
  if (!isDeepStrictEqual(manifest, verification.manifest)) {
    throw new Error(`${verification.target} extracted manifest changed after ZIP verification`)
  }
  if (modelBytes.byteLength !== verification.model.byteLength || sha256(modelBytes) !== verification.model.sha256) {
    throw new Error(`${verification.target} extracted model changed after ZIP verification`)
  }
  return true
}

export async function extractAndVerifyPackagedArchive(packagedArtifact, destination) {
  const { entries, verification } = await readAndVerifyPackagedArchive(packagedArtifact)
  await mkdir(destination)
  for (const name of Object.keys(entries).sort()) {
    const absolutePath = path.join(destination, ...name.split('/'))
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, entries[name])
  }
  await verifyExtractedPackagedTree(destination, verification)
  return verification
}

export function assertMatchingArchiveVerification(packagedArtifact, verification) {
  if (
    verification?.target !== packagedArtifact.target ||
    !isDeepStrictEqual(verification.archive, packagedArtifact.artifact.archive) ||
    !isDeepStrictEqual(verification.model, packagedArtifact.artifact.model) ||
    !isDeepStrictEqual(verification.oracle, packagedArtifact.oracle) ||
    !Number.isSafeInteger(verification.tree?.fileCount) ||
    !/^[a-f0-9]{64}$/u.test(verification.tree?.sha256 ?? '')
  ) {
    throw new Error(`${packagedArtifact.target} tested archive verification does not match artifact metadata`)
  }
  return true
}
