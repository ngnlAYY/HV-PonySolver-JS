import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

  it('accepts ordinary function names and sink-like strings and comments through the CLI', async () => {
    const result = await runCheckerWithSource(`
function createFunction(source) { return source }
createFunction('return input')
const text = "Function(source); new Function(source)"
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

  it('scans browser-core and extension sources', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'packages/browser-core/src/status-panel/panel.ts', 'node.innerHTML = unsafe\n')
      await writeSource(repoRoot, 'apps/extension/src/content/main.ts', "new Function('unsafe')\n")

      await assert.rejects(checkBrowserSinks(repoRoot), /unexpected innerHTML sink[\s\S]*unexpected Function sink/)
    })
  })

  it('ignores sink-like text in comments and strings', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/app/app.ts',
        "// node.innerHTML = userInput\nconst text = 'new Function(importScripts)'\n",
      )

      await assert.doesNotReject(checkBrowserSinks(repoRoot))
    })
  })
})
