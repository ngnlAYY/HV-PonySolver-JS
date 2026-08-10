import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { checkBrowserSinks } from './check-browser-sinks.mjs'

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

describe('checkBrowserSinks', () => {
  it('accepts known audited browser sink files', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/status-panel/status-panel.ts', 'el.innerHTML = html\n')
      await writeSource(repoRoot, 'apps/userscript/src/inference/onnx-worker-external-entry.ts', 'importScripts(url)\n')

      await assert.doesNotReject(checkBrowserSinks(repoRoot))
    })
  })

  it('rejects extra sinks in allowlisted files', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/status-panel/status-panel.ts', 'el.innerHTML = html\nother.innerHTML = userInput\n')

      await assert.rejects(checkBrowserSinks(repoRoot), /unexpected innerHTML sink/)
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
      await writeSource(repoRoot, 'apps/userscript/src/app/app.ts', "node['innerHTML'] = userInput\nnode.innerHTML += suffix\n")

      await assert.rejects(checkBrowserSinks(repoRoot), /unexpected innerHTML sink/)
    })
  })

  it('rejects unexpected dynamic runtime sinks', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/app/runtime-loader.ts', "new Function('return input')\nself.importScripts(url)\n")

      await assert.rejects(checkBrowserSinks(repoRoot), /unexpected new Function sink[\s\S]*unexpected importScripts sink/)
    })
  })

  it('rejects explicit repo roots without userscript sources', async () => {
    await withRepo(async (repoRoot) => {
      await assert.rejects(checkBrowserSinks(repoRoot, { requireSourceDir: true }), /apps\/userscript\/src is missing/)
    })
  })

  it('ignores sink-like text in comments and strings', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/app/app.ts', "// node.innerHTML = userInput\nconst text = 'new Function(importScripts)'\n")

      await assert.doesNotReject(checkBrowserSinks(repoRoot))
    })
  })
})
