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
const runtimeSource = `self.ort = { marker: ${JSON.stringify(runtimeMarker)} };`
const runtimeByteLength = 60
const runtimeSha256 = '5259978e2c9e098e157db55ce652398eee871f059417927c42742512696bb055'
const mainBundleBudgetBytes = 80_000
const workerBundleBudgetBytes = 20_000

test('build-userscript defaults to remote onnxruntime-web runtime', async () => {
  const output = await runBuildInTempDir({ HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME: '' })

  assert.equal(output.includes('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js'), true)
  assert.equal(output.includes(runtimeMarker), false)
})

test('build-userscript embeds onnxruntime-web runtime when enabled', async () => {
  const output = await runBuildInTempDir({
    HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME: '1',
    runtimeSource,
    runtimeByteLength,
    runtimeSha256,
  })

  assert.equal(output.includes(runtimeMarker), true)
})

test('build-userscript rejects bundled runtime sources with unexpected byte length', async () => {
  await assert.rejects(
    runBuildInTempDir({
      HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME: '1',
      runtimeSource,
      runtimeByteLength: 1,
      runtimeSha256,
    }),
    /ONNX runtime source size must be 1 bytes/,
  )
})

test('build-userscript rejects bundled runtime sources with unexpected SHA-256', async () => {
  await assert.rejects(
    runBuildInTempDir({
      HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME: '1',
      runtimeSource,
      runtimeByteLength,
      runtimeSha256: '0000000000000000000000000000000000000000000000000000000000000000',
    }),
    /ONNX runtime source SHA-256 mismatch/,
  )
})

test('build-userscript does not minify by default', async () => {
  const output = await runBuildInTempDir({})

  assert.equal(output.includes('(() => {'), true)
  assert.equal(output.includes('(()=>{'), false)
})

test('build-userscript minifies main and worker bundles when requested by CLI flag', async () => {
  const output = await runBuildInTempDir({ args: ['--minify'] })

  assert.equal(output.includes('(()=>{'), true)
  assert.equal(output.includes('function loadBundledRuntime'), false)
})

test('build-userscript minifies main and worker bundles when CLI flag is true', async () => {
  const output = await runBuildInTempDir({ args: ['--minify=true'] })

  assert.equal(output.includes('(()=>{'), true)
  assert.equal(output.includes('function loadBundledRuntime'), false)
})

test('build-userscript keeps bundles unminified when CLI flag is false', async () => {
  const output = await runBuildInTempDir({ args: ['--minify=false'] })

  assert.equal(output.includes('(() => {'), true)
  assert.equal(output.includes('function loadBundledRuntime'), true)
})

test('build-userscript keeps bundles unminified for unsupported minify values', async () => {
  const output = await runBuildInTempDir({ args: ['--minify=1'] })

  assert.equal(output.includes('(() => {'), true)
  assert.equal(output.includes('function loadBundledRuntime'), true)
})

test('build-userscript uses the last minify CLI flag', async () => {
  const minifiedOutput = await runBuildInTempDir({ args: ['--minify=false', '--minify'] })
  const unminifiedOutput = await runBuildInTempDir({ args: ['--minify', '--minify=false'] })

  assert.equal(minifiedOutput.includes('(()=>{'), true)
  assert.equal(unminifiedOutput.includes('(() => {'), true)
})

test('build-userscript ignores the removed HV_PONY_SOLVER_MINIFY environment variable', async () => {
  const output = await runBuildInTempDir({ HV_PONY_SOLVER_MINIFY: '1' })

  assert.equal(output.includes('(() => {'), true)
  assert.equal(output.includes('(()=>{'), false)
})

test('build-userscript writes an esbuild metafile when requested', async () => {
  const { output, metafile } = await runBuildInTempDir({ withMetafile: true })

  const parsedMetafile = JSON.parse(metafile)

  assert.equal(output.includes('HV-PonySolver-Local'), true)
  assert.equal(metafile.includes('src/main.ts'), true)
  assert.equal(metafile.includes('src/inference/onnx-worker-entry.ts'), true)
  const mainOutput = Object.values(parsedMetafile.main.outputs)[0]
  const workerOutput = Object.values(parsedMetafile.worker.outputs)[0]
  assert.ok(mainOutput.bytes < mainBundleBudgetBytes, `main bundle ${mainOutput.bytes} bytes exceeds ${mainBundleBudgetBytes}`)
  assert.ok(workerOutput.bytes < workerBundleBudgetBytes, `worker bundle ${workerOutput.bytes} bytes exceeds ${workerBundleBudgetBytes}`)
})

async function runBuildInTempDir({ args = [], runtimeSource, runtimeByteLength, runtimeSha256, withMetafile, ...env }) {
  const outputDir = await mkdtemp(join(tmpdir(), 'hv-pony-userscript-'))
  try {
    const runtimePath = runtimeSource ? join(outputDir, 'ort.min.js') : undefined
    const outputPath = join(outputDir, 'hv-pony-solver.user.js')
    const metafilePath = withMetafile ? join(outputDir, 'meta.json') : undefined
    if (runtimePath) {
      await writeFile(runtimePath, runtimeSource)
    }
    await execFileAsync(process.execPath, [resolve(appDir, 'scripts/build-userscript.mjs'), ...args], {
      cwd: resolve(appDir, '../..'),
      env: {
        ...process.env,
        ...env,
        ...(runtimePath ? { HV_PONY_SOLVER_ONNX_RUNTIME_PATH: runtimePath } : {}),
        ...(metafilePath ? { HV_PONY_SOLVER_METAFILE_PATH: metafilePath } : {}),
        ...(runtimeByteLength ? { HV_PONY_SOLVER_ONNX_RUNTIME_BYTE_LENGTH: String(runtimeByteLength) } : {}),
        ...(runtimeSha256 ? { HV_PONY_SOLVER_ONNX_RUNTIME_SHA256: runtimeSha256 } : {}),
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
