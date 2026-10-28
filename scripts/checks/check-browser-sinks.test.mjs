import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { browserSourceDirs, checkBrowserSinks } from './check-browser-sinks.mjs'

async function withRepo(callback) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'browser-sinks-'))
  try {
    return await callback(repoRoot)
  } finally {
    await rm(repoRoot, { recursive: true, force: true })
  }
}

async function writeSource(repoRoot, relativePath, content) {
  const fullPath = join(repoRoot, relativePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content)
}

async function runCheckerWithSource(source) {
  return withRepo(async (repoRoot) => {
    for (const sourceDir of browserSourceDirs) {
      await mkdir(join(repoRoot, sourceDir), { recursive: true })
    }
    await writeSource(repoRoot, 'apps/userscript/src/app/runtime-loader.ts', source)
    return spawnSync(
      process.execPath,
      [fileURLToPath(new globalThis.URL('./check-browser-sinks.mjs', import.meta.url)), '--repo-root', repoRoot],
      { encoding: 'utf8' },
    )
  })
}

describe('checkBrowserSinks', () => {
  it('accepts known audited browser sink files', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/onnx-worker-external-entry.ts', 'importScripts(url)\n')

      await assert.doesNotReject(checkBrowserSinks(repoRoot))
    })
  })

  it('rejects extra sinks in allowlisted files', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/onnx-worker-external-entry.ts',
        'importScripts(url)\nimportScripts(otherUrl)\n',
      )

      await assert.rejects(checkBrowserSinks(repoRoot), /unexpected importScripts sink/)
    })
  })

  it('rejects unexpected innerHTML assignments', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/app/app.ts', 'node.innerHTML = userInput\n')

      await assert.rejects(checkBrowserSinks(repoRoot), /unexpected innerHTML sink/)
    })
  })

  it('rejects unexpected computed and compound innerHTML writes', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/app/app.ts',
        "node['innerHTML'] = userInput\nnode.innerHTML += suffix\n",
      )

      await assert.rejects(checkBrowserSinks(repoRoot), /unexpected innerHTML sink/)
    })
  })

  it('rejects unexpected dynamic runtime sinks', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/app/runtime-loader.ts',
        "Function('return input')\nnew Function('return input')\nself.importScripts(url)\n",
      )

      await assert.rejects(
        checkBrowserSinks(repoRoot),
        /unexpected Function sink[\s\S]*unexpected Function sink[\s\S]*unexpected importScripts sink/,
      )
    })
  })

  it('rejects both Function constructor forms through the CLI', async () => {
    for (const source of ["Function('return input')\n", "new Function('return input')\n"]) {
      const result = await runCheckerWithSource(source)

      assert.notEqual(result.status, 0, result.stdout)
      assert.match(result.stderr, /unexpected Function sink: apps\/userscript\/src\/app\/runtime-loader\.ts/)
    }
  })

  for (const source of [
    "globalThis.Function('return input')",
    "new window['Function']('return input')",
    "new (self[`Function`])('return input')",
    "(Function as FunctionConstructor)('return input')",
    "(globalThis as typeof globalThis).Function('return input')",
    "(<FunctionConstructor>Function)('return input')",
    "new (<FunctionConstructor>Function)('return input')",
    "(<typeof globalThis>globalThis).Function('return input')",
  ]) {
    it(`rejects the global Function constructor through ${source}`, async () => {
      await withRepo(async (repoRoot) => {
        await writeSource(repoRoot, 'apps/userscript/src/app/runtime-loader.ts', source)
        await assert.rejects(checkBrowserSinks(repoRoot), /unexpected Function sink/)
      })
    })
  }

  it('rejects computed importScripts and parenthesized innerHTML writes', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/app/app.ts',
        'self[`importScripts`](url); (node.innerHTML) = input',
      )
      await assert.rejects(checkBrowserSinks(repoRoot), /unexpected importScripts sink[\s\S]*unexpected innerHTML sink/)
    })
  })

  for (const extension of ['mts', 'cts', 'cjs', 'jsx']) {
    it(`checks browser sinks in nested .${extension} sources`, async () => {
      await withRepo(async (repoRoot) => {
        await writeSource(
          repoRoot,
          `apps/extension/src/nested/entry.${extension}`,
          extension === 'jsx' ? "<div>{Function('return input')()}</div>" : "Function('return input')",
        )
        await assert.rejects(checkBrowserSinks(repoRoot), /unexpected Function sink/)
      })
    })
  }

  it('accepts ordinary function names and sink-like strings and comments through the CLI', async () => {
    const result = await runCheckerWithSource(`
function createFunction(source) { return source }
createFunction('return input')
const text = "Function(source); new Function(source)"
const ignoredSinks = 'new Function(importScripts)'
// node.innerHTML = userInput
// Function(source)
/* new Function(source) */
`)

    assert.equal(result.status, 0, result.stderr)
  })

  it('rejects explicit repo roots without userscript sources', async () => {
    await withRepo(async (repoRoot) => {
      await assert.rejects(
        checkBrowserSinks(repoRoot, { requireSourceDir: true }),
        /browser sink source directories are missing/,
      )
    })
  })

  it('requires all protected directories when the CLI selects its default repository root', async () => {
    await withRepo(async (repoRoot) => {
      const actualRoot = resolve(import.meta.dirname, '../..')
      for (const file of [
        'scripts/checks/check-browser-sinks.mjs',
        'scripts/lib/cli.mjs',
        'scripts/lib/direct-run.mjs',
        'scripts/lib/source-files.mjs',
      ]) {
        await mkdir(dirname(join(repoRoot, file)), { recursive: true })
        await copyFile(join(actualRoot, file), join(repoRoot, file))
      }
      await symlink(join(actualRoot, 'node_modules'), join(repoRoot, 'node_modules'), 'junction')
      const run = () =>
        spawnSync(process.execPath, [join(repoRoot, 'scripts/checks/check-browser-sinks.mjs')], {
          cwd: tmpdir(),
          encoding: 'utf8',
        })
      const missing = run()
      assert.equal(missing.status, 1)
      assert.match(missing.stderr, /browser sink source directories are missing/)
      for (const sourceDir of browserSourceDirs) {
        await mkdir(join(repoRoot, sourceDir), { recursive: true })
      }
      const complete = run()
      assert.equal(complete.status, 0, complete.stderr)
      assert.match(complete.stdout, /Browser sink check passed/)
    })
  })

  it('scans browser-core and extension sources', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'packages/browser-core/src/status-panel/panel.ts', 'node.innerHTML = unsafe\n')
      await writeSource(repoRoot, 'apps/extension/src/content/main.ts', "new Function('unsafe')\n")

      await assert.rejects(checkBrowserSinks(repoRoot), /unexpected innerHTML sink[\s\S]*unexpected Function sink/)
    })
  })
})
