import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile as readFileFromDisk,
  rm,
  writeFile as writeFileToDisk,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { checkDocsDrift } from '../check-docs-drift.mjs'
import { COMMAND_DOCUMENTS } from '../documentation-paths.mjs'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const scriptPath = join(repoRoot, 'scripts/docs-drift/check-docs-drift.mjs')
const packageManagerVersion = JSON.parse(
  await readFileFromDisk(join(repoRoot, 'package.json'), 'utf8'),
).packageManager.split('@')[1]

const fixtureRoots = new Set()
const baselineReads = new Map()

// 用例只写覆盖文件，其余读取来自只读基线；CLI smoke 仍使用完整磁盘 fixture。
async function readFile(file, encoding) {
  try {
    return await readFileFromDisk(file, encoding)
  } catch (error) {
    const absolute = resolve(file instanceof globalThis.URL ? fileURLToPath(file) : file)
    const fixture = [...fixtureRoots].find((root) => absolute.startsWith(`${root}${sep}`))
    if (error.code !== 'ENOENT' || !fixture) throw error
    const baselinePath = join(repoRoot, relative(fixture, absolute))
    if (encoding !== 'utf8') return readFileFromDisk(baselinePath, encoding)
    if (!baselineReads.has(baselinePath)) baselineReads.set(baselinePath, readFileFromDisk(baselinePath, encoding))
    return baselineReads.get(baselinePath)
  }
}

async function writeFile(file, ...args) {
  await mkdir(dirname(file), { recursive: true })
  return writeFileToDisk(file, ...args)
}

async function runCheck(cwd) {
  try {
    const errors = await checkDocsDrift(cwd, { readText: (file) => readFile(join(cwd, file), 'utf8') })
    return {
      exitCode: errors.length ? 1 : 0,
      stdout: errors.length ? '' : 'Docs drift check passed\n',
      stderr: errors.map((error) => `Docs drift: ${error}\n`).join(''),
    }
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: `${error.message}\n` }
  }
}

async function runCliCheck(cwd) {
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

async function createFixture(options = {}) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'hv-docs-drift-'))
  fixtureRoots.add(fixtureRoot)
  const files = [
    'README.md',
    'docs/development/commands.md',
    'docs/architecture/browser-runtime.md',
    'docs/architecture/overview.md',
    'docs/reference/model-worker-http.md',
    'docs/development/releases.md',
    'package.json',
    'apps/userscript/package.json',
    'apps/extension/package.json',
    'apps/model-worker/package.json',
    'packages/browser-core/package.json',
    'packages/shared/package.json',
    'apps/extension/scripts/build/build-extension.mjs',
    'apps/extension/scripts/browser/browser-support.mjs',
    'apps/extension/src/platform/extension-paths.ts',
    'docs/browser-extension.md',
    'docs/model-cache-strategy.md',
    'docs/model-worker-ops.md',
    'docs/onnx-runtime.md',
    '.github/workflows/deploy-cloudflare-model-worker.yml',
    'packages/browser-core/src/inference/inference-config.ts',
    'apps/userscript/src/inference/onnx-runtime-assets.ts',
    'apps/model-worker/src/request-router.ts',
    'apps/model-worker/src/model-access.ts',
    'apps/model-worker/src/model-response.ts',
    'packages/shared/src/model.ts',
  ]

  await Promise.all(
    (options.materialize
      ? [...new Set([...files, ...COMMAND_DOCUMENTS])]
      : ['apps/extension/scripts/browser/browser-support.mjs', 'apps/extension/src/platform/extension-paths.ts']
    ).map(async (file) => {
      await mkdir(join(fixtureRoot, dirname(file)), { recursive: true })
      await copyFile(join(repoRoot, file), join(fixtureRoot, file))
    }),
  )
  return fixtureRoot
}

async function withFixture(callback, options = {}) {
  const fixtureRoot = await createFixture(options)
  try {
    return await callback(fixtureRoot)
  } finally {
    fixtureRoots.delete(fixtureRoot)
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}

export { packageManagerVersion, repoRoot, readFile, runCheck, runCliCheck, withFixture, writeFile }
