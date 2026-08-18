import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, it } from 'node:test'

import {
  BUNDLE_BUDGET_PROFILES,
  checkBundleBudget,
  evaluateBundleBudget,
  formatBundleBudgetResult,
  parseArgs,
} from './check-bundle-budget.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = join(repoRoot, 'scripts/check-bundle-budget.mjs')
const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createFixture(byteLength) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'bundle-budget-'))
  temporaryDirectories.push(fixtureRoot)
  const artifactPath = join(fixtureRoot, 'artifact.user.js')
  await writeFile(artifactPath, Buffer.alloc(byteLength))
  return { fixtureRoot, artifactPath }
}

async function runCheck(args) {
  try {
    const result = await execFileAsync(process.execPath, [scriptPath, ...args], { cwd: repoRoot })
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }
  }
}

describe('root bundle gate', () => {
  it('builds the default userscript without minification before enforcing the budget', async () => {
    const rootPackage = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))

    assert.equal(
      rootPackage.scripts?.['bundle:check'],
      'corepack pnpm --filter @hv-pony-solver/userscript build && corepack pnpm bundle:check:default',
    )
  })
})

describe('bundle budget evaluation', () => {
  it('pins both profile budgets', () => {
    assert.equal(BUNDLE_BUDGET_PROFILES.default.budgetBytes, 128 * 1024)
    assert.equal(BUNDLE_BUDGET_PROFILES.bundled.budgetBytes, 480 * 1024)
  })

  it('accepts an artifact exactly at its budget', () => {
    assert.deepEqual(
      evaluateBundleBudget({
        profile: 'default',
        artifactPath: '/tmp/artifact.user.js',
        actualBytes: 128 * 1024,
        budgetBytes: 128 * 1024,
      }),
      {
        profile: 'default',
        artifactPath: '/tmp/artifact.user.js',
        actualBytes: 128 * 1024,
        budgetBytes: 128 * 1024,
        deltaBytes: 0,
        withinBudget: true,
      },
    )
  })

  it('reports a positive delta when the artifact exceeds its budget', () => {
    const result = evaluateBundleBudget({
      profile: 'bundled',
      artifactPath: '/tmp/artifact.user.js',
      actualBytes: 500_000,
      budgetBytes: 480 * 1024,
    })

    assert.equal(result.deltaBytes, 8_480)
    assert.equal(result.withinBudget, false)
    assert.match(
      formatBundleBudgetResult(result),
      /profile=bundled actual=500000 B \(488\.28 KiB\) budget=491520 B \(480 KiB\) delta=\+8480 B \(\+8\.28 KiB\)/,
    )
  })
})

describe('bundle budget checking', () => {
  it('checks a custom file against the selected profile', async () => {
    const { fixtureRoot, artifactPath } = await createFixture(72_160)

    const result = await checkBundleBudget({ repoRoot: fixtureRoot, profile: 'default', file: artifactPath })

    assert.equal(result.actualBytes, 72_160)
    assert.equal(result.budgetBytes, 128 * 1024)
    assert.equal(result.deltaBytes, -58_912)
    assert.equal(result.withinBudget, true)
  })

  it('fails clearly when the artifact is missing', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'bundle-budget-missing-'))
    temporaryDirectories.push(fixtureRoot)

    await assert.rejects(
      checkBundleBudget({ repoRoot: fixtureRoot, profile: 'default' }),
      /profile=default actual=missing budget=131072 B \(128 KiB\) delta=n\/a.*artifact does not exist.*build the artifact before checking/,
    )
  })

  it('fails clearly when the artifact exceeds the budget', async () => {
    const { fixtureRoot, artifactPath } = await createFixture(BUNDLE_BUDGET_PROFILES.default.budgetBytes + 1)

    await assert.rejects(
      checkBundleBudget({ repoRoot: fixtureRoot, profile: 'default', file: artifactPath }),
      /Bundle budget exceeded: profile=default actual=131073 B \(128\.00 KiB\) budget=131072 B \(128 KiB\) delta=\+1 B \(\+0\.00 KiB\)/,
    )
  })
})

describe('bundle budget CLI', () => {
  it('parses a supported profile, file, and repo root', () => {
    assert.deepEqual(parseArgs(['--profile', 'bundled', '--file', 'custom.user.js', '--repo-root', '/tmp/repo']), {
      profile: 'bundled',
      file: 'custom.user.js',
      repoRoot: resolve('/tmp/repo'),
    })
  })

  it('rejects unknown profiles and arguments', () => {
    assert.throws(() => parseArgs(['--profile', 'other']), /Unknown bundle budget profile: other/)
    assert.throws(() => parseArgs(['--profile', '__proto__']), /Unknown bundle budget profile: __proto__/)
    assert.throws(() => parseArgs(['--other']), /Unknown argument: --other/)
  })

  it('prints all required values and exits zero when within budget', async () => {
    const { artifactPath } = await createFixture(72_160)

    const result = await runCheck(['--profile', 'default', '--file', artifactPath])

    assert.equal(result.exitCode, 0, result.stderr)
    assert.match(result.stdout, /profile=default/)
    assert.match(result.stdout, /actual=72160 B \(70\.47 KiB\)/)
    assert.match(result.stdout, /budget=131072 B \(128 KiB\)/)
    assert.match(result.stdout, /delta=-58912 B \(-57\.53 KiB\)/)
  })

  it('exits non-zero and prints the overage when over budget', async () => {
    const { artifactPath } = await createFixture(BUNDLE_BUDGET_PROFILES.bundled.budgetBytes + 1024)

    const result = await runCheck(['--profile', 'bundled', '--file', artifactPath])

    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /profile=bundled/)
    assert.match(result.stderr, /actual=492544 B \(481 KiB\)/)
    assert.match(result.stderr, /budget=491520 B \(480 KiB\)/)
    assert.match(result.stderr, /delta=\+1024 B \(\+1 KiB\)/)
  })

  it('exits non-zero when the target file is missing', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'bundle-budget-cli-missing-'))
    temporaryDirectories.push(fixtureRoot)
    const missingPath = join(fixtureRoot, 'missing.user.js')
    await mkdir(join(fixtureRoot, 'unused'))

    const result = await runCheck(['--profile', 'default', '--file', missingPath])

    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /actual=missing/)
    assert.match(result.stderr, /build the artifact before checking/)
  })
})
