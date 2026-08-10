import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  createArtifactManifest,
  createMainBuildOptions,
  createMetafileJson,
  createUserscriptOutput,
  createWorkerBuildOptions,
  parseMinifyFlag,
  parseRuntimeProfile,
  validateUserscriptMetadata,
} from './build-userscript.mjs'

const execFileAsync = promisify(execFile)
const appDir = resolve(import.meta.dirname, '..')
const runtimeManifest = {
  externalFullRuntime: {
    scriptUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js',
    wasmBaseUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
  },
  wasmAsset: {
    url: 'https://models.example/runtime/ort-wasm-hash.wasm',
    byteLength: 1_267_937,
    sha256: 'a'.repeat(64),
    maxByteLength: 2_000_000,
  },
}

test('parseMinifyFlag uses the last explicit minify setting', () => {
  assert.equal(parseMinifyFlag([]), false)
  assert.equal(parseMinifyFlag(['--minify']), true)
  assert.equal(parseMinifyFlag(['--minify=false']), false)
  assert.equal(parseMinifyFlag(['--minify=false', '--minify']), true)
  assert.equal(parseMinifyFlag(['--minify', '--minify=false']), false)
})

test('parseRuntimeProfile defaults to external and accepts only explicit profiles', () => {
  assert.equal(parseRuntimeProfile([]), 'external')
  assert.equal(parseRuntimeProfile(['--runtime=bundled']), 'bundled')
  assert.equal(parseRuntimeProfile(['--runtime', 'external']), 'external')
  assert.throws(() => parseRuntimeProfile(['--runtime=unknown']), /Unknown runtime profile/)
})

test('metadata and output helpers retain the userscript boundary', () => {
  const metadata = '// ==UserScript==\n// @name Test\n// ==/UserScript=='
  assert.equal(validateUserscriptMetadata(metadata), undefined)
  assert.equal(createUserscriptOutput(metadata, '(() => {})();'), `${metadata}\n\n(() => {})();`)
  assert.throws(() => validateUserscriptMetadata('// @name Test'), /must start/)
})

test('build options select external full and bundled minimal runtime providers', () => {
  const externalWorker = createWorkerBuildOptions({
    workerEntryPoint: '/app/external-worker.ts',
    runtimeProfile: 'external',
    runtimeManifest,
    shouldMinify: false,
    shouldWriteMetafile: true,
  })
  assert.equal(externalWorker.alias, undefined)
  assert.deepEqual(externalWorker.define, {
    __HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_URL__: JSON.stringify(runtimeManifest.externalFullRuntime.scriptUrl),
    __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BASE_URL__: JSON.stringify(runtimeManifest.externalFullRuntime.wasmBaseUrl),
  })

  const bundledWorker = createWorkerBuildOptions({
    workerEntryPoint: '/app/bundled-worker.ts',
    runtimeProfile: 'bundled',
    runtimeBundlePath: '/app/vendor/ort.wasm.bundle.min.mjs',
    runtimeManifest,
    shouldMinify: true,
    shouldWriteMetafile: true,
  })
  assert.deepEqual(bundledWorker.alias, { 'onnxruntime-web/wasm': '/app/vendor/ort.wasm.bundle.min.mjs' })
  assert.deepEqual(bundledWorker.define, {
    'import.meta.url': '"https://models.example/runtime/ort-wasm-hash.wasm"',
    __HV_PONY_SOLVER_BUNDLED_ORT_WASM_URL__: '"https://models.example/runtime/ort-wasm-hash.wasm"',
    __HV_PONY_SOLVER_BUNDLED_ORT_WASM_BYTE_LENGTH__: '1267937',
    __HV_PONY_SOLVER_BUNDLED_ORT_WASM_SHA256__: `"${'a'.repeat(64)}"`,
    __HV_PONY_SOLVER_BUNDLED_ORT_WASM_MAX_BYTE_LENGTH__: '2000000',
  })
  assert.equal(bundledWorker.minify, true)

  const main = createMainBuildOptions({
    entryPoint: '/app/main.ts',
    shouldMinify: false,
    shouldWriteMetafile: true,
    workerScriptText: 'self.onmessage = () => {}',
  })
  assert.equal(main.define.__HV_PONY_SOLVER_WORKER_SCRIPT__, JSON.stringify('self.onmessage = () => {}'))
})

test('manifest helpers record the selected runtime profile', () => {
  assert.equal(createMetafileJson({ a: 1 }, { b: 2 }), JSON.stringify({ main: { a: 1 }, worker: { b: 2 } }, null, 2))
  assert.deepEqual(
    createArtifactManifest({
      outputFile: 'out.user.js',
      byteLength: 12,
      sha256: 'a'.repeat(64),
      minified: true,
      bundledRuntime: false,
    }),
    { artifact: 'out.user.js', byteLength: 12, sha256: 'a'.repeat(64), minified: true, bundledRuntime: false },
  )
})

test('default build downloads the pinned full runtime and excludes minimal runtime assets', async () => {
  const result = await runBuildInTempDir({ withMetafile: true })
  assert.match(result.output, /cdn\.jsdelivr\.net\/npm\/onnxruntime-web@1\.27\.0\/dist\/ort\.min\.js/)
  assert.match(result.output, /cdn\.jsdelivr\.net\/npm\/onnxruntime-web@1\.27\.0\/dist\//)
  assert.match(result.output, /models\.ngnl\.host\/yolo26n-640\.ort/)
  assert.doesNotMatch(result.output, /wasmBinary/)
  assert.doesNotMatch(result.output, /models\.ngnl\.host\/runtime\/ort-wasm-simd-/)
  const metafile = JSON.parse(result.metafile)
  const workerOutput = Object.values(metafile.worker.outputs)[0]
  assert.ok(workerOutput.bytes < 20_000, `external worker bundle ${workerOutput.bytes} bytes exceeds 20000`)
})

test('bundled build embeds the custom glue and uses the verified first-party minimal WASM', async () => {
  const result = await runBuildInTempDir({ args: ['--runtime=bundled'], withMetafile: true })
  assert.match(result.output, /wasmBinary/)
  assert.match(result.output, /models\.ngnl\.host\/runtime\/ort-wasm-simd-/)
  assert.doesNotMatch(result.output, /cdn\.jsdelivr\.net\/npm\/onnxruntime-web@1\.27\.0\/dist\/ort\.min\.js/)
  const metafile = JSON.parse(result.metafile)
  const workerOutput = Object.values(metafile.worker.outputs)[0]
  assert.ok(workerOutput.bytes < 250_000, `bundled worker bundle ${workerOutput.bytes} bytes exceeds 250000`)
})

test('build rejects an integrity-mismatched custom runtime bundle', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'hv-pony-bad-runtime-'))
  try {
    const runtimePath = join(tempDir, 'ort.wasm.bundle.min.mjs')
    await writeFile(runtimePath, 'export const invalid = true')
    await assert.rejects(
      runBuildInTempDir({ args: ['--runtime=bundled'], runtimeBundlePath: runtimePath }),
      /Custom ONNX Runtime bundle integrity mismatch/,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('minified default build writes external-profile artifact integrity outputs', async () => {
  const result = await runBuildInTempDir({ args: ['--minify'], withArtifactManifest: true })
  const manifest = JSON.parse(result.artifactManifest)
  assert.equal(manifest.minified, true)
  assert.equal(manifest.bundledRuntime, false)
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/)
  assert.equal(manifest.sha256, result.sha256Text.trim())
})

test('minified bundled build records its embedded runtime', async () => {
  const result = await runBuildInTempDir({
    args: ['--runtime=bundled', '--minify'],
    withArtifactManifest: true,
  })
  assert.equal(JSON.parse(result.artifactManifest).bundledRuntime, true)
})

async function runBuildInTempDir({ args = [], runtimeBundlePath, withMetafile, withArtifactManifest } = {}) {
  const outputDir = await mkdtemp(join(tmpdir(), 'hv-pony-userscript-'))
  try {
    const outputPath = join(outputDir, 'hv-pony-solver.user.js')
    const metafilePath = withMetafile ? join(outputDir, 'meta.json') : undefined
    const artifactManifestPath = withArtifactManifest ? join(outputDir, 'artifact.json') : undefined
    const artifactSha256Path = withArtifactManifest ? join(outputDir, 'artifact.sha256') : undefined
    await execFileAsync(process.execPath, [resolve(appDir, 'scripts/build-userscript.mjs'), ...args], {
      cwd: resolve(appDir, '../..'),
      env: {
        ...process.env,
        HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH: outputPath,
        ...(runtimeBundlePath ? { HV_PONY_SOLVER_ONNX_RUNTIME_BUNDLE_PATH: runtimeBundlePath } : {}),
        ...(metafilePath ? { HV_PONY_SOLVER_METAFILE_PATH: metafilePath } : {}),
        ...(artifactManifestPath ? { HV_PONY_SOLVER_ARTIFACT_MANIFEST_PATH: artifactManifestPath } : {}),
        ...(artifactSha256Path ? { HV_PONY_SOLVER_ARTIFACT_SHA256_PATH: artifactSha256Path } : {}),
      },
    })
    return {
      output: await readFile(outputPath, 'utf8'),
      ...(metafilePath ? { metafile: await readFile(metafilePath, 'utf8') } : {}),
      ...(artifactManifestPath ? { artifactManifest: await readFile(artifactManifestPath, 'utf8') } : {}),
      ...(artifactSha256Path ? { sha256Text: await readFile(artifactSha256Path, 'utf8') } : {}),
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true })
  }
}
