import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { BOUNDARY_RULES, checkArchitectureBoundaries } from './check-architecture-boundaries.mjs'

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
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/parser.ts',
        "import { ANSWER_CODES } from '@hv-pony-solver/shared'\nimport type { StatusPanel } from '../status-panel/status-panel-types'\n",
      )
      await writeSource(
        repoRoot,
        'apps/userscript/src/status-panel/status-panel.ts',
        "import { HistoryStore } from '../persistence/answer-history-store'\n",
      )
      await writeSource(
        repoRoot,
        'apps/model-worker/src/request-router.ts',
        "import { ModelAccessDecision } from '@hv-pony-solver/shared'\n",
      )

      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
    })
  })

  it('accepts inline type-only contract imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/parser.ts',
        "import { type StatusPanel } from '../status-panel/status-panel-types'\n",
      )

      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
    })
  })

  it('rejects mixed runtime and inline type imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "import { StatusPanel, type PanelStatus } from '../status-panel/status-panel-types'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /inference layer must not import status panel/)
    })
  })

  it('rejects default imports mixed with inline type imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "import StatusPanel, { type PanelStatus } from '../status-panel/status-panel-types'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /inference layer must not import status panel/)
    })
  })

  it('rejects direct inference-to-status-panel imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "import { StatusPanel } from '../status-panel/status-panel'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /inference layer must not import status panel/)
    })
  })

  it('rejects inference imports that target the forbidden directory itself', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "import { StatusPanel } from '../status-panel'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /inference layer must not import status panel/)
    })
  })

  it('rejects deeper inference imports that target the forbidden directory itself', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/nested/client.ts',
        "import { StatusPanel } from '../../status-panel'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /inference layer must not import status panel/)
    })
  })

  it('rejects commented direct inference-to-status-panel imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "import { StatusPanel } from /* comment */ '../status-panel/status-panel'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /inference layer must not import status panel/)
    })
  })

  it('rejects commented side-effect imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "import /* comment */ '../status-panel/status-panel'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /inference layer must not import status panel/)
    })
  })

  it('does not reject paths with partial forbidden path segments', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "import { StatusPanelOther } from '../status-panel-other/status-panel'\n",
      )

      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
    })
  })

  it('rejects commented direct inference-to-status-panel exports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "export { StatusPanel } from /* comment */ '../status-panel/status-panel'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /inference layer must not import status panel/)
    })
  })

  it('rejects commented dynamic inference-to-status-panel imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "await import(/* comment */ '../status-panel/status-panel')\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /inference layer must not import status panel/)
    })
  })

  it('rejects dynamic imports with comments before the call arguments', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "await import/* comment */('../status-panel/status-panel')\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /inference layer must not import status panel/)
    })
  })

  it('does not treat property calls named import as dynamic imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "obj.import('../status-panel/status-panel')\n",
      )

      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
    })
  })

  it('does not treat import calls inside template strings as dynamic imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "const s = `import('../status-panel/status-panel')`\n",
      )

      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
    })
  })

  it('rejects direct status-panel-to-inference imports', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/status-panel/status-panel.ts',
        "import { parseYoloOutput } from '../inference/yolo-output-parser'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /status panel must not import inference/)
    })
  })

  it('rejects cross-application imports between model-worker and userscript', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/model-worker/src/index.ts',
        "import { App } from '../../userscript/src/app/app'\n",
      )

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /model worker must not import browser applications or browser core/,
      )
    })
  })

  for (const [name, file, source, violation] of [
    [
      'model-worker relative browser-core imports',
      'apps/model-worker/src/index.ts',
      "import { App } from '../../../packages/browser-core/src/app/app'",
      /model worker must not import browser applications or browser core/,
    ],
    [
      'model-worker browser-core imports with parent path segments',
      'apps/model-worker/src/index.ts',
      "await import('../../../packages/shared/../browser-core/src/app/app')",
      /model worker must not import browser applications or browser core/,
    ],
    [
      'model-worker type-only browser-core imports',
      'apps/model-worker/src/index.ts',
      "import type { DetectorService } from '@hv-pony-solver/browser-core/inference/inference-types'",
      /model worker must not import browser applications or browser core/,
    ],
    [
      'shared type-only application imports',
      'packages/shared/src/model.ts',
      "import type { ExtensionSender } from '../../../apps/extension/src/platform/webextension-api'",
      /shared package must not import apps or browser core/,
    ],
    [
      'shared relative browser-core re-exports',
      'packages/shared/src/model.ts',
      "export type { DetectorService } from '../../browser-core/src/inference/inference-types'",
      /shared package must not import apps or browser core/,
    ],
    [
      'browser-core inline type-only application imports',
      'packages/browser-core/src/app/app.ts',
      "import { type ExtensionSender } from '@hv-pony-solver/extension/platform/webextension-api'",
      /browser core must not import applications/,
    ],
    [
      'shared browser-core imports through the repository packages directory',
      'packages/shared/src/model.ts',
      "import type { DetectorService } from '../../../packages/browser-core/src/inference/inference-types'",
      /shared package must not import apps or browser core/,
    ],
    [
      'userscript type-only extension imports',
      'apps/userscript/src/app/app.ts',
      "import type { ExtensionSender } from '../../../extension/src/platform/webextension-api'",
      /userscript must not import other applications/,
    ],
    [
      'extension type-only userscript re-exports',
      'apps/extension/src/content/main.ts',
      "export type { App } from '../../../userscript/src/app/app'",
      /extension must not import private application code/,
    ],
  ]) {
    it(`rejects ${name}`, async () => {
      await withRepo(async (repoRoot) => {
        await writeSource(repoRoot, file, source)
        await assert.rejects(checkArchitectureBoundaries(repoRoot), violation)
      })
    })
  }

  for (const source of [
    "export type Sender = import('../../../apps/extension/src/platform/webextension-api').ExtensionSender",
    "export type ExtensionApi = typeof import('../../../apps/extension/src/platform/webextension-api')",
  ]) {
    it(`rejects reverse dependencies expressed as ${source}`, async () => {
      await withRepo(async (repoRoot) => {
        for (const directory of new Set(BOUNDARY_RULES.map((rule) => rule.fromDir))) {
          await mkdir(join(repoRoot, directory), { recursive: true })
        }
        await writeSource(
          repoRoot,
          'apps/extension/src/platform/webextension-api.ts',
          'export type ExtensionSender = { id?: string }',
        )
        await writeSource(repoRoot, 'packages/shared/src/contract.ts', source)
        await assert.rejects(
          checkArchitectureBoundaries(repoRoot, { requireSourceDirs: true }),
          /shared package must not import apps or browser core/,
        )
      })
    })
  }

  it('preserves permitted type-query imports and ignores string/comment decoys', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/parser.ts',
        "type Panel = import('../status-panel/status-panel-types').Panel",
      )
      await writeSource(
        repoRoot,
        'packages/shared/src/contract.ts',
        `// type Bad = import('@hv-pony-solver/extension').Bad
const text = "type Bad = import('@hv-pony-solver/extension').Bad"
`,
      )
      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
    })
  })

  it('rejects normalized runtime imports while preserving adjacent directory names', async () => {
    await withRepo(async (repoRoot) => {
      const file = 'apps/userscript/src/inference/client.ts'
      await writeSource(repoRoot, file, "import { value } from '../other/../status-panel-other/value'")
      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
      await writeSource(repoRoot, file, "import { value } from '../other/../status-panel/value'")
      await assert.rejects(checkArchitectureBoundaries(repoRoot), /inference layer must not import status panel/)
    })
  })

  it('resolves explicit source extensions without rejecting adjacent filenames', async () => {
    await withRepo(async (repoRoot) => {
      const file = 'apps/userscript/src/inference/client.ts'
      await writeSource(repoRoot, file, "import { value } from '../userscript/gm-bridge-other.ts'")
      await assert.doesNotReject(checkArchitectureBoundaries(repoRoot))
      await writeSource(repoRoot, file, "import { value } from '../userscript/gm-bridge.ts'")
      await assert.rejects(checkArchitectureBoundaries(repoRoot), /must not import userscript storage bridge/)
    })
  })

  it('rejects extension imports from private userscript source', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/extension/src/content/main.ts',
        "import { App } from '../../../userscript/src/app/app'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /extension must not import private application code/)
    })
  })

  it('rejects type-only application imports from private browser-core source paths', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/test/model/cache.test.ts',
        "import type { ModelCache } from '../../../../packages/browser-core/src/model/model-cache'\n",
      )

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /userscript must consume browser core through its package root/,
      )
    })
  })

  it('rejects browser-core imports from applications', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'packages/browser-core/src/app/app.ts',
        "import { getValue } from '../../../../apps/userscript/src/userscript/gm-bridge'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /browser core must not import applications/)
    })
  })

  it('rejects explicit repo roots without boundary source directories', async () => {
    await withRepo(async (repoRoot) => {
      await assert.rejects(
        checkArchitectureBoundaries(repoRoot, { requireSourceDirs: true }),
        /architecture boundary source directories are missing/,
      )
    })
  })

  it('requires all protected directories when the CLI selects its default repository root', async () => {
    await withRepo(async (repoRoot) => {
      const actualRoot = resolve(import.meta.dirname, '../..')
      for (const file of [
        'scripts/checks/check-architecture-boundaries.mjs',
        'scripts/lib/cli.mjs',
        'scripts/lib/direct-run.mjs',
        'scripts/lib/source-files.mjs',
      ]) {
        await mkdir(dirname(join(repoRoot, file)), { recursive: true })
        await copyFile(join(actualRoot, file), join(repoRoot, file))
      }
      await symlink(join(actualRoot, 'node_modules'), join(repoRoot, 'node_modules'), 'junction')
      const command = () =>
        execFileSync(process.execPath, [join(repoRoot, 'scripts/checks/check-architecture-boundaries.mjs')], {
          cwd: tmpdir(),
          encoding: 'utf8',
          stdio: 'pipe',
        })

      assert.throws(command, (error) => {
        assert.equal(error.status, 1)
        assert.match(error.stderr, /architecture boundary source directories are missing/)
        return true
      })

      for (const directory of new Set(BOUNDARY_RULES.map((rule) => rule.fromDir))) {
        await mkdir(join(repoRoot, directory), { recursive: true })
      }
      assert.match(command(), /Architecture boundary check passed/)
    })
  })

  it('rejects explicit repo roots with partial boundary source directories', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(repoRoot, 'apps/userscript/src/inference/client.ts', '')

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot, { requireSourceDirs: true }),
        /architecture boundary source directories are missing/,
      )
    })
  })

  it('rejects shared imports from application code', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'packages/shared/src/model.ts',
        "import { App } from '../../apps/userscript/src/app/app'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /shared package must not import apps or browser core/)
    })
  })

  it('rejects nested shared imports from application code', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'packages/shared/src/nested/model.ts',
        "import { App } from '../../../apps/userscript/src/app/app'\n",
      )

      await assert.rejects(checkArchitectureBoundaries(repoRoot), /shared package must not import apps or browser core/)
    })
  })

  it('rejects inference runtime imports from userscript storage bridge', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/client.ts',
        "import { getGmValue } from '../userscript/gm-bridge'\n",
      )

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import userscript storage bridge/,
      )
    })
  })

  it('rejects nested inference runtime imports from userscript storage bridge', async () => {
    await withRepo(async (repoRoot) => {
      await writeSource(
        repoRoot,
        'apps/userscript/src/inference/nested/client.ts',
        "import { getGmValue } from '../../userscript/gm-bridge'\n",
      )

      await assert.rejects(
        checkArchitectureBoundaries(repoRoot),
        /inference layer must not import userscript storage bridge/,
      )
    })
  })
})
