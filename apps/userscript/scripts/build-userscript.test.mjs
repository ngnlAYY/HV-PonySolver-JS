import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  createMainBuildOptions,
  createMetafileJson,
  createUserscriptOutput,
  createWorkerBuildOptions,
  parseMinifyFlag,
  validateUserscriptMetadata,
  workerRuntimeSourcePlaceholder,
} from './build-userscript.mjs'

const execFileAsync = promisify(execFile)
const appDir = resolve(import.meta.dirname, '..')
const runtimeMarker = 'HV_PONY_SOLVER_TEST_RUNTIME_MARKER'
const runtimeSource = `self.ort = { marker: ${JSON.stringify(runtimeMarker)} };`
const runtimeByteLength = 60
const runtimeSha256 = '5259978e2c9e098e157db55ce652398eee871f059417927c42742512696bb055'
const mainBundleBudgetBytes = 80_000
const workerBundleBudgetBytes = 20_000

test('parseMinifyFlag only enables minification for the last explicit true flag', () => {
  assert.equal(parseMinifyFlag([]), false)
  assert.equal(parseMinifyFlag(['--minify']), true)
  assert.equal(parseMinifyFlag(['--minify=true']), true)
  assert.equal(parseMinifyFlag(['--minify=false']), false)
  assert.equal(parseMinifyFlag(['--minify=1']), false)
  assert.equal(parseMinifyFlag(['--minify=false', '--minify']), true)
  assert.equal(parseMinifyFlag(['--minify', '--minify=false']), false)
})

test('validateUserscriptMetadata accepts only complete userscript metadata blocks', () => {
  const metadata = '// ==UserScript==\n// @name        Test\n// ==/UserScript=='

  assert.equal(validateUserscriptMetadata(metadata), undefined)
  assert.throws(() => validateUserscriptMetadata('// @name        Test\n// ==/UserScript=='), /must start/)
  assert.throws(() => validateUserscriptMetadata('// ==UserScript==\n// @name        Test'), /must end/)
})

test('createUserscriptOutput joins metadata and bundled text with a blank line', () => {
  assert.equal(createUserscriptOutput('// ==UserScript==\n// ==/UserScript==', '(() => {})();'), '// ==UserScript==\n// ==/UserScript==\n\n(() => {})();')
})

test('createMetafileJson preserves main and worker esbuild metafiles', () => {
  const metafileJson = createMetafileJson({ outputs: { 'main.js': { bytes: 1 } } }, { outputs: { 'worker.js': { bytes: 2 } } })

  assert.equal(metafileJson, JSON.stringify({
    main: { outputs: { 'main.js': { bytes: 1 } } },
    worker: { outputs: { 'worker.js': { bytes: 2 } } },
  }, null, 2))
})

test('createWorkerBuildOptions defines the runtime source placeholder', () => {
  const options = createWorkerBuildOptions({
    workerEntryPoint: '/app/src/inference/onnx-worker-entry.ts',
    shouldMinify: true,
    shouldWriteMetafile: true,
  })

  assert.deepEqual(options.entryPoints, ['/app/src/inference/onnx-worker-entry.ts'])
  assert.equal(options.minify, true)
  assert.equal(options.metafile, true)
  assert.equal(options.define.__HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE__, JSON.stringify(workerRuntimeSourcePlaceholder))
})

test('createMainBuildOptions injects ONNX runtime and worker script sources', () => {
  const options = createMainBuildOptions({
    entryPoint: '/app/src/main.ts',
    shouldMinify: false,
    shouldWriteMetafile: true,
    onnxRuntimeSource: 'self.ort = {};',
    workerScriptText: 'self.onmessage = () => {};',
  })

  assert.deepEqual(options.entryPoints, ['/app/src/main.ts'])
  assert.equal(options.minify, false)
  assert.equal(options.metafile, true)
  assert.equal(options.define.__HV_PONY_SOLVER_ONNX_RUNTIME_SOURCE__, JSON.stringify('self.ort = {};'))
  assert.equal(options.define.__HV_PONY_SOLVER_WORKER_SCRIPT__, JSON.stringify('self.onmessage = () => {};'))
})

test('build-userscript defaults to remote onnxruntime-web runtime', async () => {
  const output = await runBuildInTempDir({ HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME: '' })

  assert.equal(output.includes('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js'), true)
  assert.equal(output.includes(runtimeMarker), false)
  assert.equal(output.includes('// @grant       GM_registerMenuCommand'), true)
  assert.equal(output.includes('// @grant       GM_getValue'), true)
  assert.equal(output.includes('// @grant       GM_setValue'), true)
  assert.equal(output.includes('// @grant       GM_deleteValue'), true)
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
