import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

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

test('parses the custom bundle and content-addressed first-party WASM contract', () => {
  const manifest = parseOnnxRuntimeAssetsManifest(manifestSource())
  assert.equal(manifest.packageVersion, '1.27.0')
  assert.equal(manifest.externalFullRuntime.scriptUrl, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.min.js')
  assert.equal(manifest.externalFullRuntime.wasmBaseUrl, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/')
  assert.equal(manifest.bundleAsset.sha256, sha256(bundleBytes))
  assert.equal(manifest.wasmAsset.filename, `ort-wasm-simd-${wasmSha}.wasm`)
  assert.equal(manifest.wasmAsset.url, `https://models.ngnl.host/runtime/ort-wasm-simd-${wasmSha}.wasm`)
})

test('rejects non-content-addressed WASM filenames', () => {
  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(manifestSource().replaceAll(`ort-wasm-simd-${wasmSha}.wasm`, 'ort-wasm-simd.wasm')),
    /not content-addressed/,
  )
})

test('rejects first-party URL drift', () => {
  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(manifestSource().replace('https://models.ngnl.host/runtime/', 'https://cdn.example/runtime/')),
    /URL drift/,
  )
})

test('rejects external full runtime URL drift', () => {
  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(manifestSource().replace('cdn.jsdelivr.net', 'cdn.example')),
    /External ONNX Runtime script URL drift/,
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
