import assert from 'node:assert/strict'
import test from 'node:test'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = join(repoRoot, 'scripts/check-docs-drift.mjs')

async function runCheck(cwd) {
  try {
    const result = await execFileAsync(process.execPath, [scriptPath, '--repo-root', cwd], { cwd })
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }
  }
}

async function createFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'hv-docs-drift-'))
  const files = [
    'README.md',
    'package.json',
    'docs/userscript.md',
    'docs/deployment.md',
    'docs/architecture.md',
    'apps/userscript/src/inference/inference-config.ts',
    'packages/shared/src/model.ts',
  ]

  await Promise.all(files.map(async (file) => {
    await mkdir(join(fixtureRoot, file, '..'), { recursive: true })
    await copyFile(join(repoRoot, file), join(fixtureRoot, file))
  }))
  return fixtureRoot
}

async function withFixture(callback) {
  const fixtureRoot = await createFixture()
  try {
    return await callback(fixtureRoot)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}

test('current repository docs are in sync with source facts', async () => {
  const result = await runCheck(repoRoot)
  assert.equal(result.exitCode, 0, result.stderr)
  assert.match(result.stdout, /Docs drift check passed/)
})

test('fails clearly when README omits test:coverage from pnpm check description', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, readme.replace('test:coverage、', ''))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*pnpm check.*test:coverage/s)
  })
})

test('fails clearly when deployment docs omit docs:check from corepack pnpm check description', async () => {
  await withFixture(async (fixtureRoot) => {
    const deploymentDocPath = join(fixtureRoot, 'docs/deployment.md')
    const deploymentDoc = await readFile(deploymentDocPath, 'utf8')
    await writeFile(deploymentDocPath, deploymentDoc.replace(' / docs:check', ''))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/deployment\.md.*corepack pnpm check.*docs:check/s)
  })
})

test('fails clearly when deployment docs omit test:coverage from corepack pnpm check description', async () => {
  await withFixture(async (fixtureRoot) => {
    const deploymentDocPath = join(fixtureRoot, 'docs/deployment.md')
    const deploymentDoc = await readFile(deploymentDocPath, 'utf8')
    await writeFile(deploymentDocPath, deploymentDoc.replace(' / test:coverage', ''))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/deployment\.md.*corepack pnpm check.*test:coverage/s)
  })
})

test('fails clearly when userscript docs omit docs:check from corepack pnpm check coverage', async () => {
  await withFixture(async (fixtureRoot) => {
    const userscriptDocPath = join(fixtureRoot, 'docs/userscript.md')
    const userscriptDoc = await readFile(userscriptDocPath, 'utf8')
    await writeFile(userscriptDocPath, userscriptDoc.replaceAll('docs:check', 'docs check'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/userscript\.md.*pnpm check.*docs:check/s)
  })
})

test('fails clearly when userscript docs omit test:coverage from corepack pnpm check coverage', async () => {
  await withFixture(async (fixtureRoot) => {
    const userscriptDocPath = join(fixtureRoot, 'docs/userscript.md')
    const userscriptDoc = await readFile(userscriptDocPath, 'utf8')
    await writeFile(userscriptDocPath, userscriptDoc.replace(' / test:coverage', ''))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/userscript\.md.*pnpm check.*test:coverage/s)
  })
})

test('fails clearly when README omits a core userscript inference config name', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, readme.replaceAll('workerDetectTimeoutMs', 'workerDetectTimeout'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*workerDetectTimeoutMs/s)
  })
})

test('fails clearly when docs omit a focused userscript inference config export', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const userscriptDocPath = join(fixtureRoot, 'docs/userscript.md')
    const readme = await readFile(readmePath, 'utf8')
    const userscriptDoc = await readFile(userscriptDocPath, 'utf8')
    await writeFile(readmePath, readme.replaceAll('imagePreprocessConfig', 'image preprocess config'))
    await writeFile(userscriptDocPath, userscriptDoc.replaceAll('imagePreprocessConfig', 'image preprocess config'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md\/docs.*imagePreprocessConfig/s)
  })
})

test('fails clearly when userscript docs omit verify-model-integrity and MODEL_FILE', async () => {
  await withFixture(async (fixtureRoot) => {
    const userscriptDocPath = join(fixtureRoot, 'docs/userscript.md')
    const userscriptDoc = await readFile(userscriptDocPath, 'utf8')
    await writeFile(userscriptDocPath, userscriptDoc.replaceAll('verify-model-integrity', 'verify model integrity').replaceAll('MODEL_FILE', 'MODEL PATH'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/userscript\.md.*verify-model-integrity/s)
    assert.match(result.stderr, /docs\/userscript\.md.*MODEL_FILE/s)
  })
})

test('fails clearly when deployment docs omit verify-model-integrity and MODEL_FILE', async () => {
  await withFixture(async (fixtureRoot) => {
    const deploymentDocPath = join(fixtureRoot, 'docs/deployment.md')
    const deploymentDoc = await readFile(deploymentDocPath, 'utf8')
    await writeFile(deploymentDocPath, deploymentDoc.replaceAll('verify-model-integrity', 'verify model integrity').replaceAll('MODEL_FILE', 'MODEL PATH'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/deployment\.md.*verify-model-integrity/s)
    assert.match(result.stderr, /docs\/deployment\.md.*MODEL_FILE/s)
  })
})

test('fails clearly when architecture docs omit graph guardrail terms', async () => {
  await withFixture(async (fixtureRoot) => {
    const architectureDocPath = join(fixtureRoot, 'docs/architecture.md')
    const architectureDoc = await readFile(architectureDocPath, 'utf8')
    await writeFile(architectureDocPath, architectureDoc.replaceAll('graphify:check', 'graphify check'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/architecture\.md.*graphify:check/s)
  })
})
