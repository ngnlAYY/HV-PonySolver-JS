import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { ORT_RUNTIME_WASM_FILENAME, ORT_RUNTIME_WASM_INTEGRITY } from '@hv-pony-solver/shared/ort-runtime'

import {
  assetIntegrityMatches,
  parseOnnxRuntimeAssetsManifest,
  readAssetStats,
  readOnnxRuntimeAssetsManifest,
  resolveRuntimeBundlePath,
} from './onnx-runtime-assets.mjs'

const bundleBytes = Buffer.from([1, 2, 3])
const wasmBytes = Buffer.from([4, 5])
const wasmSha = sha256(wasmBytes)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

test('parses the custom bundle and content-addressed first-party WASM contract', () => {
  const manifest = parseOnnxRuntimeAssetsManifest(manifestSource())
  assert.equal(manifest.packageVersion, '1.27.0')
  assert.equal(
    manifest.externalFullRuntime.scriptUrl,
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js',
  )
  assert.equal(manifest.externalFullRuntime.wasmBaseUrl, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/')
  assert.equal(
    manifest.externalFullRuntime.wasmUrl,
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.wasm',
  )
  assert.equal(manifest.externalFullRuntime.wasmByteLength, 26_827_543)
  assert.equal(manifest.externalFullRuntime.wasmSha256, 'd'.repeat(64))
  assert.equal(manifest.externalFullRuntime.wasmMaxByteLength, 30_000_000)
  assert.equal(manifest.externalFullRuntime.byteLength, 360_434)
  assert.equal(manifest.externalFullRuntime.sha256, 'c'.repeat(64))
  assert.equal(manifest.externalFullRuntime.maxByteLength, 400_000)
  assert.equal(manifest.bundleAsset.sha256, sha256(bundleBytes))
  assert.equal(manifest.wasmAsset.filename, `ort-wasm-simd-${wasmSha}.wasm`)
  assert.equal(manifest.wasmAsset.url, `https://models.ngnl.host/runtime/ort-wasm-simd-${wasmSha}.wasm`)
})

test('rejects non-content-addressed WASM filenames', () => {
  assert.throws(
    () =>
      parseOnnxRuntimeAssetsManifest(
        manifestSource().replaceAll(`ort-wasm-simd-${wasmSha}.wasm`, 'ort-wasm-simd.wasm'),
      ),
    /not content-addressed/,
  )
})

test('rejects first-party URL drift', () => {
  assert.throws(
    () =>
      parseOnnxRuntimeAssetsManifest(
        manifestSource().replace('https://models.ngnl.host/runtime/', 'https://cdn.example/runtime/'),
      ),
    /URL drift/,
  )
})

test('rejects external full runtime URL drift', () => {
  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(manifestSource().replace('cdn.jsdelivr.net', 'cdn.example')),
    /External ONNX Runtime script URL drift/,
  )
})

test('rejects an invalid or over-budget external full runtime integrity contract', () => {
  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(manifestSource().replace(`sha256: '${'c'.repeat(64)}'`, "sha256: 'bad'")),
    /externalFullRuntime\.sha256/,
  )
  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(manifestSource().replace('maxByteLength: 400_000', 'maxByteLength: 300_000')),
    /external full runtime exceeds maxByteLength/,
  )
})

test('reads and verifies the tracked custom bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hv-pony-runtime-assets-'))
  try {
    const manifestPath = join(root, 'apps/userscript/src/inference/onnx-runtime-assets.ts')
    const bundlePath = join(root, 'apps/userscript/vendor/onnxruntime/ort.wasm.bundle.min.mjs')
    await mkdir(dirname(manifestPath), { recursive: true })
    await mkdir(dirname(bundlePath), { recursive: true })
    await writeFile(manifestPath, manifestSource())
    await writeFile(bundlePath, bundleBytes)
    const manifest = await readOnnxRuntimeAssetsManifest(root)
    const stats = await readAssetStats(resolveRuntimeBundlePath(manifest, root))
    assert.equal(assetIntegrityMatches(stats, manifest.bundleAsset), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('keeps the tracked userscript WASM manifest aligned with the shared runtime contract', async () => {
  const manifest = await readOnnxRuntimeAssetsManifest(repositoryRoot)
  const publicPath = `/runtime/${ORT_RUNTIME_WASM_FILENAME}`
  const objectKey = `runtime/${ORT_RUNTIME_WASM_FILENAME}`

  assert.equal(manifest.wasmAsset.filename, ORT_RUNTIME_WASM_FILENAME)
  assert.equal(manifest.wasmAsset.publicPath, publicPath)
  assert.equal(manifest.wasmAsset.objectKey, objectKey)
  assert.equal(manifest.wasmAsset.byteLength, ORT_RUNTIME_WASM_INTEGRITY.byteLength)
  assert.equal(manifest.wasmAsset.sha256, ORT_RUNTIME_WASM_INTEGRITY.sha256)
  assert.equal(manifest.wasmAsset.url, `https://models.ngnl.host${publicPath}`)
})

function manifestSource() {
  return `export const ONNX_RUNTIME_ASSETS = {
  packageName: 'onnxruntime-web',
  packageVersion: '1.27.0',
  sourceCommit: '${'a'.repeat(40)}',
  emsdkVersion: '4.0.23',
  operatorConfigSha256: '${'b'.repeat(64)}',
  externalFullRuntime: {
    scriptUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js',
    wasmBaseUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
    wasmUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.wasm',
    wasmByteLength: 26_827_543,
    wasmSha256: '${'d'.repeat(64)}',
    wasmMaxByteLength: 30_000_000,
    byteLength: 360_434,
    sha256: '${'c'.repeat(64)}',
    maxByteLength: 400_000,
  },
  bundleAsset: {
    path: 'apps/userscript/vendor/onnxruntime/ort.wasm.bundle.min.mjs',
    filename: 'ort.wasm.bundle.min.mjs',
    byteLength: ${bundleBytes.byteLength},
    sha256: '${sha256(bundleBytes)}',
    maxByteLength: 100,
  },
  wasmAsset: {
    filename: 'ort-wasm-simd-${wasmSha}.wasm',
    publicPath: '/runtime/ort-wasm-simd-${wasmSha}.wasm',
    url: 'https://models.ngnl.host/runtime/ort-wasm-simd-${wasmSha}.wasm',
    objectKey: 'runtime/ort-wasm-simd-${wasmSha}.wasm',
    byteLength: ${wasmBytes.byteLength},
    sha256: '${wasmSha}',
    maxByteLength: 100,
  },
} as const\n`
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
