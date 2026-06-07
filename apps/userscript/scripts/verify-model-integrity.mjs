import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDir, '../../..')

if (isDirectRun()) {
  try {
    await runCli(process.env.MODEL_FILE)
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

async function runCli(modelFile) {
  const actual = await readModelStats(modelFile)
  const expected = await readExpectedIntegrity(resolveRepoRoot(process.argv.slice(2)))
  if (!modelIntegrityMatches(actual, expected)) {
    writeError('Model integrity mismatch')
    writeError(`Expected: byteLength: ${expected.byteLength}, sha256: ${expected.sha256}`)
    writeError(`Actual: byteLength: ${actual.byteLength}, sha256: ${actual.sha256}`)
    process.exitCode = 1
    return
  }
  writeOutput(`Model integrity verified: byteLength=${actual.byteLength}, sha256=${actual.sha256}`)
}

function isDirectRun() {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
}

function resolveRepoRoot(args) {
  const repoRootIndex = args.indexOf('--repo-root')
  if (repoRootIndex === -1) {
    return defaultRepoRoot
  }
  const repoRoot = args[repoRootIndex + 1]
  if (!repoRoot) {
    throw new Error('--repo-root requires a path')
  }
  return resolve(repoRoot)
}

function modelIntegrityMatches(actual, expected) {
  return actual.byteLength === expected.byteLength && actual.sha256 === expected.sha256
}

function writeOutput(message) {
  process.stdout.write(`${message}\n`)
}

function writeError(message) {
  process.stderr.write(`${message}\n`)
}

async function readModelStats(modelFile) {
  if (!modelFile) {
    throw new Error('MODEL_FILE is required')
  }
  const resolvedPath = resolve(modelFile)
  let stats
  try {
    stats = await stat(resolvedPath)
  } catch {
    throw new Error(`MODEL_FILE does not exist: ${resolvedPath}`)
  }
  if (!stats.isFile()) {
    throw new Error(`MODEL_FILE is not a file: ${resolvedPath}`)
  }
  const bytes = await readFile(resolvedPath)
  return {
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

export { modelIntegrityMatches, readExpectedIntegrity, readModelStats }

function parseByteLength(value) {
  if (!/^[0-9]+(?:_[0-9]+)*$/.test(value)) {
    throw new Error(`Invalid MODEL_INTEGRITY.byteLength: ${value}`)
  }
  return Number(value.replaceAll('_', ''))
}

async function readExpectedIntegrity(repoRoot = defaultRepoRoot) {
  const sharedModelPath = resolve(repoRoot, 'packages/shared/src/model.ts')
  const source = await readFile(sharedModelPath, 'utf8')
  const byteLengthMatch = source.match(/MODEL_INTEGRITY\s*=\s*{[\s\S]*?['"]?byteLength['"]?\s*:\s*([0-9][0-9_]*)/)
  const sha256Match = source.match(/MODEL_INTEGRITY\s*=\s*{[\s\S]*?['"]?sha256['"]?\s*:\s*['"]([a-fA-F0-9]{64})['"]/)
  if (!byteLengthMatch?.[1]) {
    throw new Error(`Unable to read MODEL_INTEGRITY.byteLength from ${sharedModelPath}`)
  }
  if (!sha256Match?.[1]) {
    throw new Error(`Unable to read MODEL_INTEGRITY.sha256 from ${sharedModelPath}`)
  }
  return {
    byteLength: parseByteLength(byteLengthMatch[1]),
    sha256: sha256Match[1].toLowerCase(),
  }
}

