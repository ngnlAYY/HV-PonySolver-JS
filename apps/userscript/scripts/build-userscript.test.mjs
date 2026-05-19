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

  assert.equal(output.includes('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js'), true)
  assert.equal(output.includes(runtimeMarker), false)
})

test('build-userscript embeds onnxruntime-web runtime when enabled', async () => {
  const output = await runBuildInTempDir({
    HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME: '1',
    runtimeSource: `self.ort = { marker: ${JSON.stringify(runtimeMarker)} };`,
  })

  assert.equal(output.includes(runtimeMarker), true)
})

test('build-userscript writes an esbuild metafile when requested', async () => {
  const { output, metafile } = await runBuildInTempDir({ withMetafile: true })

  assert.equal(output.includes('HV-PonySolver-Local'), true)
  assert.equal(metafile.includes('src/main.ts'), true)
  assert.equal(metafile.includes('src/inference/onnx-worker-entry.ts'), true)
})

async function runBuildInTempDir({ runtimeSource, withMetafile, ...env }) {
  const outputDir = await mkdtemp(join(tmpdir(), 'hv-pony-userscript-'))
  try {
    const runtimePath = runtimeSource ? join(outputDir, 'ort.min.js') : undefined
    const outputPath = join(outputDir, 'hv-pony-solver.user.js')
    const metafilePath = withMetafile ? join(outputDir, 'meta.json') : undefined
    if (runtimePath) {
      await writeFile(runtimePath, runtimeSource)
    }
    await execFileAsync(process.execPath, [resolve(appDir, 'scripts/build-userscript.mjs')], {
      cwd: resolve(appDir, '../..'),
      env: {
        ...process.env,
        ...env,
        ...(runtimePath ? { HV_PONY_SOLVER_ONNX_RUNTIME_PATH: runtimePath } : {}),
        ...(metafilePath ? { HV_PONY_SOLVER_METAFILE_PATH: metafilePath } : {}),
        HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH: outputPath,
      },
    })
    const output = await readFile(outputPath, 'utf8')
    if (metafilePath) {
      return { output, metafile: await readFile(metafilePath, 'utf8') }
    }
    return output
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
}
