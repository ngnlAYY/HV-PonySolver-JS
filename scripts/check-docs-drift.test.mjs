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
    'apps/userscript/src/inference/inference-config.ts',
    'packages/shared/src/model.ts',
  ]

  await Promise.all(files.map(async (file) => {
    await mkdir(join(fixtureRoot, dirname(file)), { recursive: true })
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

test('current repository README is in sync with source facts', async () => {
  const result = await runCheck(repoRoot)
  assert.equal(result.exitCode, 0, result.stderr)
  assert.match(result.stdout, /Docs drift check passed/)
})

const rootCheckCommandNames = ['test:coverage', 'docs:check', 'graphify:check', 'architecture:check']

for (const commandName of rootCheckCommandNames) {
  test(`fails clearly when README omits ${commandName} from pnpm check description`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'README.md')
      const readme = await readFile(readmePath, 'utf8')
      assert.ok(readme.includes(commandName), `fixture should mention ${commandName}`)
      await writeFile(readmePath, readme.replaceAll(commandName, 'omitted check command'))

      const escapedCommandName = commandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, new RegExp(`README\\.md.*pnpm check.*${escapedCommandName}`, 's'))
    })
  })
}

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

test('fails clearly when README omits a focused userscript inference config export', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, readme.replaceAll('imagePreprocessConfig', 'image preprocess config'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*imagePreprocessConfig/s)
  })
})

test('fails clearly when README omits model manifest field names', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(
      readmePath,
      readme
        .replaceAll('MODEL_INTEGRITY.byteLength', 'MODEL_INTEGRITY byte length')
        .replaceAll('MODEL_INTEGRITY.sha256', 'MODEL_INTEGRITY sha256'),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*MODEL_INTEGRITY\.byteLength/s)
    assert.match(result.stderr, /README.md.*MODEL_INTEGRITY\.sha256/s)
  })
})

test('fails clearly when README omits verify-model-integrity and MODEL_FILE', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'README.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, readme.replaceAll('verify-model-integrity', 'verify model integrity').replaceAll('MODEL_FILE', 'MODEL PATH'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /README.md.*verify-model-integrity/s)
    assert.match(result.stderr, /README.md.*MODEL_FILE/s)
  })
})

const architectureGuardrailTerms = [
  '.graphifyignore',
  'graphify:check',
  'architecture:check',
  'inferenceTimeoutConfig',
  'StatusPanel',
  'Model Worker Core',
]

for (const requiredTerm of architectureGuardrailTerms) {
  test(`fails clearly when README guardrails omit ${requiredTerm}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'README.md')
      const readme = await readFile(readmePath, 'utf8')
      assert.ok(readme.includes(requiredTerm), `fixture should mention ${requiredTerm}`)
      await writeFile(readmePath, readme.replaceAll(requiredTerm, 'omitted architecture guardrail'))

      const escapedTerm = requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, new RegExp(`README\\.md.*${escapedTerm}`, 's'))
    })
  })
}
