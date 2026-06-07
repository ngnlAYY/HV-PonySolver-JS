import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { checkArchitectureBoundaries } from './check-architecture-boundaries.mjs'

async function createRepo() {
  return mkdtemp(join(tmpdir(), 'architecture-boundaries-'))
}

async function writeSource(repoRoot, relativePath, content) {
  const fullPath = join(repoRoot, relativePath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content)
}

describe('checkArchitectureBoundaries', () => {
  it('accepts allowed userscript, model-worker, and type-only contract imports', async () => {
    const repoRoot = await createRepo()
    await writeSource(repoRoot, 'apps/userscript/src/inference/parser.ts', "import { ANSWER_CODES } from '@hv-pony-solver/shared'\nimport type { StatusPanel } from '../status-panel/status-panel-types'\n")
    await writeSource(repoRoot, 'apps/userscript/src/status-panel/status-panel.ts', "import { HistoryStore } from '../persistence/answer-history-store'\n")
    await writeSource(repoRoot, 'apps/model-worker/src/request-router.ts', "import { ModelAccessDecision } from '@hv-pony-solver/shared'\n")

    await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
  })

  it('rejects direct inference-to-status-panel imports', async () => {
    const repoRoot = await createRepo()
    await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', "import { StatusPanel } from '../status-panel/status-panel'\n")

    await assert.rejects(
      checkArchitectureBoundaries(repoRoot),
      /inference layer must not import status panel/,
    )
  })

  it('rejects direct status-panel-to-inference imports', async () => {
    const repoRoot = await createRepo()
    await writeSource(repoRoot, 'apps/userscript/src/status-panel/status-panel.ts', "import { parseYoloOutput } from '../inference/yolo-output-parser'\n")

    await assert.rejects(
      checkArchitectureBoundaries(repoRoot),
      /status panel must not import inference/,
    )
  })

  it('rejects cross-application imports between model-worker and userscript', async () => {
    const repoRoot = await createRepo()
    await writeSource(repoRoot, 'apps/model-worker/src/index.ts', "import { App } from '../../userscript/src/app/app'\n")

    await assert.rejects(
      checkArchitectureBoundaries(repoRoot),
      /model worker must not import userscript/,
    )
  })
})
