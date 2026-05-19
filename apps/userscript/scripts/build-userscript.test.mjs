import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const appDir = resolve(import.meta.dirname, '..')
const runtimeMarker = 'HV_PONY_SOLVER_TEST_RUNTIME_MARKER'

test('build-userscript defaults to remote onnxruntime-web runtime', async () => {
  const output = await runBuildInTempDir({ HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME: '' })

  assert.equal(output.includes('importScripts(message.ortScriptUrl)'), true)
  assert.equal(output.includes(runtimeMarker), false)
})

test('build-userscript embeds onnxruntime-web runtime when enabled', async () => {
  const output = await runBuildInTempDir({
    HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME: '1',
    runtimeSource: `self.ort = { marker: ${JSON.stringify(runtimeMarker)} };`,
  })

  assert.equal(output.includes(runtimeMarker), true)
})

async function runBuildInTempDir({ runtimeSource, ...env }) {
  const outputDir = await mkdtemp(join(tmpdir(), 'hv-pony-userscript-'))
  try {
    const runtimePath = runtimeSource ? join(outputDir, 'ort.min.js') : undefined
    const outputPath = join(outputDir, 'hv-pony-solver.user.js')
    if (runtimePath) {
      await writeFile(runtimePath, runtimeSource)
    }
    await execFileAsync(process.execPath, [resolve(appDir, 'scripts/build-userscript.mjs')], {
      cwd: resolve(appDir, '../..'),
      env: {
        ...process.env,
        ...env,
        ...(runtimePath ? { HV_PONY_SOLVER_ONNX_RUNTIME_PATH: runtimePath } : {}),
        HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH: outputPath,
      },
    })
    return readFile(outputPath, 'utf8')
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
}
