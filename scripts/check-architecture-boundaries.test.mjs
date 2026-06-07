import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { checkArchitectureBoundaries } from './check-architecture-boundaries.mjs'

async function createRepo() {
  return mkdtemp(join(tmpdir(), 'architecture-boundaries-'))
}

async function withRepo(callback) {
  const repoRoot = await createRepo()
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

describe('checkArchitectureBoundaries', () => {
  it('accepts allowed userscript, model-worker, and type-only contract imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/parser.ts', "import { ANSWER_CODES } from '@hv-pony-solver/shared'\nimport type { StatusPanel } from '../status-panel/status-panel-types'\n")
      await writeSource(repoRoot, 'apps/userscript/src/status-panel/status-panel.ts', "import { HistoryStore } from '../persistence/answer-history-store'\n")
      await writeSource(repoRoot, 'apps/model-worker/src/request-router.ts', "import { ModelAccessDecision } from '@hv-pony-solver/shared'\n")

      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
    })
  })

  it('accepts inline type-only contract imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/parser.ts', "import { type StatusPanel } from '../status-panel/status-panel-types'\n")

      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
    })
  })

  it('rejects mixed runtime and inline type imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "import { StatusPanel, type PanelStatus } from '../status-panel/status-panel-types'\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import status panel/,
      )
    })
  })

  it('rejects default imports mixed with inline type imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "import StatusPanel, { type PanelStatus } from '../status-panel/status-panel-types'\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import status panel/,
      )
    })
  })

  it('rejects direct inference-to-status-panel imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "import { StatusPanel } from '../status-panel/status-panel'\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import status panel/,
      )
    })
  })

  it('rejects inference imports that target the forbidden directory itself', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "import { StatusPanel } from '../status-panel'\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import status panel/,
      )
    })
  })

  it('rejects deeper inference imports that target the forbidden directory itself', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/nested/client.ts', "import { StatusPanel } from '../../status-panel'\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import status panel/,
      )
    })
  })

  it('rejects commented direct inference-to-status-panel imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "import { StatusPanel } from /* comment */ '../status-panel/status-panel'\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import status panel/,
      )
    })
  })

  it('rejects commented side-effect imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "import /* comment */ '../status-panel/status-panel'\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import status panel/,
      )
    })
  })

  it('does not reject paths with partial forbidden path segments', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "import { StatusPanelOther } from '../status-panel-other/status-panel'\n")

      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
    })
  })

  it('rejects commented direct inference-to-status-panel exports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "export { StatusPanel } from /* comment */ '../status-panel/status-panel'\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import status panel/,
      )
    })
  })

  it('rejects commented dynamic inference-to-status-panel imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "await import(/* comment */ '../status-panel/status-panel')\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import status panel/,
      )
    })
  })

  it('rejects dynamic imports with comments before the call arguments', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "await import/* comment */('../status-panel/status-panel')\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import status panel/,
      )
    })
  })

  it('does not treat property calls named import as dynamic imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "obj.import('../status-panel/status-panel')\n")

      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
    })
  })

  it('does not treat import calls inside template strings as dynamic imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "const s = `import('../status-panel/status-panel')`\n")

      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
    })
  })

  it('rejects direct status-panel-to-inference imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/status-panel/status-panel.ts', "import { parseYoloOutput } from '../inference/yolo-output-parser'\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /status panel must not import inference/,
      )
    })
  })

  it('rejects cross-application imports between model-worker and userscript', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/model-worker/src/index.ts', "import { App } from '../../userscript/src/app/app'\n")

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /model worker must not import userscript/,
      )
    })
  })
})
