#!/usr/bin/env node
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDir, '..')
const defaultArtifactPath = 'apps/userscript/dist/hv-pony-solver.user.js'

const BUNDLE_BUDGET_PROFILES = Object.freeze({
  default: Object.freeze({
    artifactPath: defaultArtifactPath,
    budgetBytes: 128 * 1024,
  }),
  bundled: Object.freeze({
    artifactPath: defaultArtifactPath,
    budgetBytes: 480 * 1024,
  }),
})

if (isDirectRun()) {
  try {
    const options = parseArgs(process.argv.slice(2))
    const result = await checkBundleBudget(options)
    process.stdout.write(`${formatBundleBudgetResult(result)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

function isDirectRun() {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
}

function parseArgs(args) {
  let repoRoot = defaultRepoRoot
  let profile = 'default'
  let file

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--profile') {
      profile = readArgumentValue(args, index, '--profile')
      index += 1
      continue
    }
    if (arg === '--file') {
      file = readArgumentValue(args, index, '--file')
      index += 1
      continue
    }
    if (arg === '--repo-root') {
      repoRoot = resolve(readArgumentValue(args, index, '--repo-root'))
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  getBundleBudgetProfile(profile)
  return { repoRoot, profile, file }
}

function readArgumentValue(args, index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

async function checkBundleBudget({ repoRoot = defaultRepoRoot, profile = 'default', file } = {}) {
  const profileConfig = getBundleBudgetProfile(profile)
  const artifactPath = resolveArtifactPath(repoRoot, file ?? profileConfig.artifactPath)
  let actualBytes

  try {
    const artifactStats = await stat(artifactPath)
    if (!artifactStats.isFile()) {
      throw new Error('target is not a file')
    }
    actualBytes = artifactStats.size
  } catch (error) {
    const reason =
      error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? 'artifact does not exist'
        : error instanceof Error
          ? error.message
          : String(error)
    throw new Error(
      `Bundle budget check failed: profile=${profile} actual=missing budget=${formatBytes(profileConfig.budgetBytes)} delta=n/a file=${artifactPath}; ${reason}; build the artifact before checking`,
      { cause: error },
    )
  }

  const result = evaluateBundleBudget({
    profile,
    artifactPath,
    actualBytes,
    budgetBytes: profileConfig.budgetBytes,
  })
  if (!result.withinBudget) {
    throw new Error(`Bundle budget exceeded: ${formatBundleBudgetResult(result)}`)
  }
  return result
}

function getBundleBudgetProfile(profile) {
  if (!Object.hasOwn(BUNDLE_BUDGET_PROFILES, profile)) {
    throw new Error(
      `Unknown bundle budget profile: ${profile}; expected one of: ${Object.keys(BUNDLE_BUDGET_PROFILES).join(', ')}`,
    )
  }
  return BUNDLE_BUDGET_PROFILES[profile]
}

function resolveArtifactPath(repoRoot, file) {
  return isAbsolute(file) ? resolve(file) : resolve(repoRoot, file)
}

function evaluateBundleBudget({ profile, artifactPath, actualBytes, budgetBytes }) {
  validateByteCount(actualBytes, 'actualBytes')
  validateByteCount(budgetBytes, 'budgetBytes')
  const deltaBytes = actualBytes - budgetBytes
  return {
    profile,
    artifactPath,
    actualBytes,
    budgetBytes,
    deltaBytes,
    withinBudget: deltaBytes <= 0,
  }
}

function validateByteCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
}

function formatBundleBudgetResult(result) {
  return `profile=${result.profile} actual=${formatBytes(result.actualBytes)} budget=${formatBytes(result.budgetBytes)} delta=${formatDelta(result.deltaBytes)} file=${result.artifactPath}`
}

function formatBytes(bytes) {
  return `${bytes} B (${formatKibibytes(bytes)} KiB)`
}

function formatDelta(bytes) {
  const sign = bytes > 0 ? '+' : ''
  return `${sign}${bytes} B (${sign}${formatKibibytes(bytes)} KiB)`
}

function formatKibibytes(bytes) {
  const kibibytes = bytes / 1024
  return Number.isInteger(kibibytes) ? String(kibibytes) : kibibytes.toFixed(2)
}

export { BUNDLE_BUDGET_PROFILES, checkBundleBudget, evaluateBundleBudget, formatBundleBudgetResult, parseArgs }
