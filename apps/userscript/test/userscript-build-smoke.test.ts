import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const appDir = resolve(import.meta.dirname, '..')

describe('userscript build output', () => {
  it('builds the default external full runtime profile', async () => {
    const output = await buildUserscript()
    expect(output).toContain('// ==UserScript==')
    expect(output).toContain('// @name        HV-PonySolver-Local')
    expect(output).toContain('DOMContentLoaded')
    expect(output).toContain('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js')
    expect(output).not.toContain('wasmBinary')
    expect(output).not.toContain('models.ngnl.host/runtime/ort-wasm-simd-')
    expect(output).not.toContain('__HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE_PLACEHOLDER__')
  })

  it('builds the explicit bundled minimal runtime profile', async () => {
    const output = await buildUserscript(['--runtime=bundled'])
    expect(output).toContain('wasmBinary')
    expect(output).toContain('models.ngnl.host/runtime/ort-wasm-simd-')
    expect(output).not.toContain('cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js')
  })
})

async function buildUserscript(args: string[] = []): Promise<string> {
  const outputDir = await mkdtemp(join(tmpdir(), 'hv-pony-userscript-smoke-'))
  const outputPath = join(outputDir, 'hv-pony-solver.user.js')
  try {
    await execFileAsync(process.execPath, [resolve(appDir, 'scripts/build-userscript.mjs'), ...args], {
      cwd: resolve(appDir, '../..'),
      env: { ...process.env, HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH: outputPath },
    })
    return await readFile(outputPath, 'utf8')
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
}
