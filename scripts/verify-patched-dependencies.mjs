import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(scriptPath), '..')

export const PATCHED_IMAGE_SIZE_VERSION = '2.0.2'
export const IMAGE_SIZE_PATCH_SHA256 = '77c12533e3a635c4066c55da8952f4912e8210416539dc1249550fa639271595'
export const PATCHED_GHSA_IDS = Object.freeze(['GHSA-w3rx-r6r6-pgpr', 'GHSA-5p2g-fcmc-qvqq'])
export const MALICIOUS_FIXTURE_NAMES = Object.freeze(['heif', 'icns', 'jxl'])

const EXPECTED_WEB_EXT_VERSION = '10.6.0'
const EXPECTED_ADDONS_LINTER_VERSION = '10.10.0'
const PROBE_TIMEOUT_MS = 3_000
const PATCH_RELATIVE_PATH = 'patches/image-size@2.0.2.patch'
const EXPECTED_VERIFY_COMMAND = 'node scripts/verify-patched-dependencies.mjs'
const EXPECTED_AUDIT_COMMAND = 'pnpm verify:patched-dependencies && pnpm audit --audit-level high'

// Provenance: image-size/image-size#439 at
// bdbe560bfd98af6feab93b46aed67f2f0a77e4d5. The exact local patch also applies
// the same non-zero progress invariant to ICNS and tests all three parsers.
const PATCHED_ENTRYPOINTS = Object.freeze([
  'dist/detector.cjs',
  'dist/detector.mjs',
  'dist/fromFile.cjs',
  'dist/fromFile.mjs',
  'dist/index.cjs',
  'dist/index.mjs',
  'dist/lookup.cjs',
  'dist/lookup.mjs',
  'dist/types/heif.cjs',
  'dist/types/heif.mjs',
  'dist/types/icns.cjs',
  'dist/types/icns.mjs',
  'dist/types/index.cjs',
  'dist/types/index.mjs',
  'dist/types/jxl.cjs',
  'dist/types/jxl.mjs',
])

function sha256(input) {
  return createHash('sha256').update(input).digest('hex')
}

function uint32(value) {
  const output = Buffer.alloc(4)
  output.writeUInt32BE(value)
  return output
}

function isoBox(type, payload = Buffer.alloc(0), declaredSize = 8 + payload.length) {
  assert.equal(type.length, 4, `ISO box type must be four bytes: ${type}`)
  return Buffer.concat([uint32(declaredSize), Buffer.from(type, 'ascii'), payload])
}

function createHeifFixture(zeroLengthIspe) {
  const ftyp = isoBox('ftyp', Buffer.concat([Buffer.from('avif', 'ascii'), uint32(0)]))
  const ispePayload = Buffer.concat([Buffer.alloc(4), uint32(2), uint32(3)])
  const ispe = isoBox('ispe', ispePayload, zeroLengthIspe ? 0 : undefined)
  const ipco = isoBox('ipco', ispe)
  const iprp = isoBox('iprp', ipco)
  const meta = isoBox('meta', Buffer.concat([Buffer.alloc(4), iprp]))
  return Buffer.concat([ftyp, meta])
}

function createJxlContainer(finalBox) {
  const signature = isoBox('JXL ', Buffer.from([0x0d, 0x0a, 0x87, 0x0a]))
  const ftyp = isoBox('ftyp', Buffer.concat([Buffer.from('jxl ', 'ascii'), uint32(0), Buffer.from('jxl ', 'ascii')]))
  return Buffer.concat([signature, ftyp, finalBox])
}

export function createMaliciousFixture(name) {
  switch (name) {
    case 'heif':
      return createHeifFixture(true)
    case 'icns':
      return Buffer.concat([Buffer.from('icns', 'ascii'), uint32(16), Buffer.from('is32', 'ascii'), uint32(0)])
    case 'jxl':
      return createJxlContainer(isoBox('jxlp', Buffer.alloc(0), 0))
    default:
      throw new TypeError(`Unknown malicious fixture: ${name}`)
  }
}

export function createValidFixtures() {
  return [
    {
      expected: { height: 3, type: 'avif', width: 2 },
      input: createHeifFixture(false),
      name: 'heif',
    },
    {
      expected: { height: 16, type: 'icns', width: 16 },
      input: Buffer.concat([Buffer.from('icns', 'ascii'), uint32(16), Buffer.from('is32', 'ascii'), uint32(8)]),
      name: 'icns',
    },
    {
      expected: { height: 8, type: 'jxl', width: 8 },
      input: createJxlContainer(isoBox('jxlc', Buffer.from([0xff, 0x0a, 0x01, 0x00]))),
      name: 'jxl',
    },
  ]
}

async function readPackageMetadata(entryPath, expectedName) {
  let currentDirectory = dirname(entryPath)
  const filesystemRoot = parse(currentDirectory).root

  while (currentDirectory !== filesystemRoot) {
    try {
      const packageJsonPath = join(currentDirectory, 'package.json')
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
      if (packageJson.name === expectedName) {
        return { packageJson, packageJsonPath, root: currentDirectory }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }
    currentDirectory = dirname(currentDirectory)
  }

  throw new Error(`Could not find ${expectedName} package metadata from ${entryPath}`)
}

async function resolveDependencyChain() {
  const extensionRequire = createRequire(join(repoRoot, 'apps/extension/package.json'))
  const webExtEntry = extensionRequire.resolve('web-ext')
  const webExt = await readPackageMetadata(webExtEntry, 'web-ext')
  const webExtRequire = createRequire(webExtEntry)
  const addonsLinterEntry = webExtRequire.resolve('addons-linter')
  const addonsLinter = await readPackageMetadata(addonsLinterEntry, 'addons-linter')
  const addonsLinterRequire = createRequire(addonsLinterEntry)
  const imageSizeEntry = addonsLinterRequire.resolve('image-size')
  const imageSizePackage = await readPackageMetadata(imageSizeEntry, 'image-size')
  const imageSizeModule = addonsLinterRequire('image-size')

  assert.equal(webExt.packageJson.version, EXPECTED_WEB_EXT_VERSION, 'unexpected web-ext version')
  assert.equal(addonsLinter.packageJson.version, EXPECTED_ADDONS_LINTER_VERSION, 'unexpected addons-linter version')
  assert.equal(imageSizePackage.packageJson.version, PATCHED_IMAGE_SIZE_VERSION, 'unexpected image-size version')
  assert.equal(typeof imageSizeModule.imageSize, 'function', 'image-size entrypoint did not export imageSize')

  const installedEntry = await realpath(imageSizeEntry)
  assert.ok(
    installedEntry.includes(`patch_hash=${IMAGE_SIZE_PATCH_SHA256}`),
    `installed image-size is not linked to patch ${IMAGE_SIZE_PATCH_SHA256}`,
  )

  return {
    imageSize: imageSizeModule.imageSize,
    versions: {
      addonsLinter: addonsLinter.packageJson.version,
      imageSize: imageSizePackage.packageJson.version,
      webExt: webExt.packageJson.version,
    },
  }
}

function countOccurrences(input, needle) {
  return input.split(needle).length - 1
}

export function execBoundedNode(args, timeoutMs = PROBE_TIMEOUT_MS) {
  return execFileAsync(process.execPath, args, {
    cwd: repoRoot,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs,
  })
}

async function verifyRepositoryMetadata() {
  const patch = await readFile(join(repoRoot, PATCH_RELATIVE_PATH))
  const patchText = patch.toString('utf8')
  assert.equal(sha256(patch), IMAGE_SIZE_PATCH_SHA256, 'image-size patch SHA-256 changed')

  for (const entrypoint of PATCHED_ENTRYPOINTS) {
    assert.ok(
      patchText.includes(`diff --git a/${entrypoint} b/${entrypoint}`),
      `image-size patch does not cover ${entrypoint}`,
    )
  }

  assert.equal(
    countOccurrences(patchText, '+      currentOffset = ispeBox.offset + (ispeBox.size > 0 ? ispeBox.size : 8);'),
    12,
    'image-size patch has incomplete HEIF coverage',
  )
  assert.equal(
    countOccurrences(patchText, '+      imageOffset += imageHeader[1] > 0 ? imageHeader[1] : 8;'),
    12,
    'image-size patch has incomplete ICNS coverage',
  )
  assert.equal(
    countOccurrences(patchText, '+    offset = jxlpBox.offset + (jxlpBox.size > 0 ? jxlpBox.size : 8);'),
    12,
    'image-size patch has incomplete JXL coverage',
  )

  const workspace = await readFile(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
  assert.match(
    workspace,
    /^ {2}image-size@2\.0\.2: patches\/image-size@2\.0\.2\.patch$/m,
    'pnpm workspace does not declare the exact image-size patch',
  )
  const expectedAuditConfig = [
    'auditConfig:',
    '  ignoreGhsas:',
    ...PATCHED_GHSA_IDS.map((ghsa) => `    - ${ghsa}`),
  ].join('\n')
  const auditConfigOffset = workspace.indexOf('auditConfig:')
  assert.notEqual(auditConfigOffset, -1, 'pnpm workspace does not declare exact GHSA ignores')
  assert.equal(
    workspace.slice(auditConfigOffset).trimEnd(),
    expectedAuditConfig,
    'pnpm workspace audit config must contain only the two patched GHSA IDs',
  )

  const lockfile = await readFile(join(repoRoot, 'pnpm-lock.yaml'), 'utf8')
  assert.deepEqual(
    lockfile.split('\n').filter((line) => line.startsWith('  image-size@')),
    [
      `  image-size@${PATCHED_IMAGE_SIZE_VERSION}: ${IMAGE_SIZE_PATCH_SHA256}`,
      `  image-size@${PATCHED_IMAGE_SIZE_VERSION}:`,
      `  image-size@${PATCHED_IMAGE_SIZE_VERSION}(patch_hash=${IMAGE_SIZE_PATCH_SHA256}): {}`,
    ],
    'lockfile must contain only the exact patched image-size version',
  )
  assert.match(
    lockfile,
    new RegExp(`^  image-size@2\\.0\\.2: ${IMAGE_SIZE_PATCH_SHA256}$`, 'm'),
    'lockfile patch hash does not match the reviewed patch',
  )
  assert.match(
    lockfile,
    new RegExp(`^  image-size@2\\.0\\.2\\(patch_hash=${IMAGE_SIZE_PATCH_SHA256}\\): \\{\\}$`, 'm'),
    'lockfile does not resolve the patched image-size snapshot',
  )
  assert.doesNotMatch(lockfile, /^ {2}adm-zip@0\.5\.18:/m, 'vulnerable adm-zip version remains locked')
  assert.doesNotMatch(lockfile, /^ {2}shell-quote@1\.8\.4:/m, 'vulnerable shell-quote version remains locked')

  const extensionPackage = JSON.parse(await readFile(join(repoRoot, 'apps/extension/package.json'), 'utf8'))
  assert.equal(
    extensionPackage.devDependencies?.['web-ext'],
    EXPECTED_WEB_EXT_VERSION,
    'extension package must pin the exact reviewed web-ext version',
  )

  const rootPackage = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(
    rootPackage.scripts['verify:patched-dependencies'],
    EXPECTED_VERIFY_COMMAND,
    'patched dependency verifier command changed',
  )
  assert.equal(
    rootPackage.scripts['audit:high'],
    EXPECTED_AUDIT_COMMAND,
    'audit command must verify the patch before applying exact GHSA ignores',
  )
}

async function runMaliciousProbe(name) {
  try {
    const { stdout } = await execBoundedNode([scriptPath, '--probe', name])
    const outcome = JSON.parse(stdout.trim())
    assert.equal(outcome.fixture, name)
    assert.ok(['returned', 'threw'].includes(outcome.status))
    return outcome
  } catch (error) {
    throw new Error(`${name} malicious fixture did not settle within ${PROBE_TIMEOUT_MS} ms or failed its probe`, {
      cause: error,
    })
  }
}

async function runProbeProcess(name) {
  assert.ok(MALICIOUS_FIXTURE_NAMES.includes(name), `unsupported malicious fixture: ${name}`)
  const { imageSize } = await resolveDependencyChain()
  let status = 'returned'
  try {
    imageSize(createMaliciousFixture(name))
  } catch {
    status = 'threw'
  }
  process.stdout.write(`${JSON.stringify({ fixture: name, status })}\n`)
}

export async function verifyPatchedDependencies() {
  await verifyRepositoryMetadata()
  const { imageSize, versions } = await resolveDependencyChain()

  for (const fixture of createValidFixtures()) {
    const result = imageSize(fixture.input)
    assert.deepEqual(
      { height: result.height, type: result.type, width: result.width },
      fixture.expected,
      `${fixture.name} valid fixture regressed`,
    )
  }

  const probes = []
  for (const name of MALICIOUS_FIXTURE_NAMES) {
    probes.push(await runMaliciousProbe(name))
  }

  return { patchSha256: IMAGE_SIZE_PATCH_SHA256, probes, versions }
}

async function main() {
  if (process.argv[2] === '--probe') {
    await runProbeProcess(process.argv[3])
    return
  }

  const result = await verifyPatchedDependencies()
  process.stdout.write(
    `Patched dependency verification passed: web-ext=${result.versions.webExt}, ` +
      `addons-linter=${result.versions.addonsLinter}, image-size=${result.versions.imageSize}, ` +
      `patch=${result.patchSha256}, probes=${result.probes.length}\n`,
  )
}

if (pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exitCode = 1
  })
}
