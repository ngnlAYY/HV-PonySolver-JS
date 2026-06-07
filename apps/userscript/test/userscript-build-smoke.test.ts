import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const appDir = resolve(import.meta.dirname, '..')

describe('userscript build output', () => {
  it('contains metadata, bootstrap, and worker script injection markers', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'hv-pony-userscript-smoke-'))
    const outputPath = join(outputDir, 'hv-pony-solver.user.js')

    try {
      await execFileAsync(process.execPath, [resolve(appDir, 'scripts/build-userscript.mjs')], {
        cwd: resolve(appDir, '../..'),
        env: {
          ...process.env,
          HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME: undefined,
          HV_PONY_SOLVER_METAFILE_PATH: undefined,
          HV_PONY_SOLVER_ONNX_RUNTIME_BYTE_LENGTH: undefined,
          HV_PONY_SOLVER_ONNX_RUNTIME_PATH: undefined,
          HV_PONY_SOLVER_ONNX_RUNTIME_SHA256: undefined,
          HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH: outputPath,
        },
      })
      const output = await readFile(outputPath, 'utf8')

      expect(output).toContain('// ==UserScript==')
      expect(output).toContain('// @name        HV-PonySolver-Local')
      expect(output).toContain('HV-PonySolver')
      expect(output).toContain('__HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE_PLACEHOLDER__')
      expect(output).toContain('DOMContentLoaded')
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  })
})
