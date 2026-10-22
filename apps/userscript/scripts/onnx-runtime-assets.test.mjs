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
    manifest.externalFullRuntime.mjsUrl,
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.mjs',
  )
  assert.equal(manifest.externalFullRuntime.mjsByteLength, 46_614)
  assert.equal(manifest.externalFullRuntime.mjsSha256, 'e'.repeat(64))
  assert.equal(manifest.externalFullRuntime.mjsMaxByteLength, 64_000)
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

test('reads only the real top-level declaration and accepts harmless literal syntax', () => {
  const misleading = "const example = 'ONNX_RUNTIME_ASSETS = { byteLength: 1 }'\n"
  const source = `${misleading}// ONNX_RUNTIME_ASSETS = { ignored: 1 }\n${manifestSource()}`.replace(
    "packageName: 'onnxruntime-web'",
    '"packageName": "onnxruntime-web"',
  )
  assert.equal(parseOnnxRuntimeAssetsManifest(source).packageName, 'onnxruntime-web')
  assert.equal(parseOnnxRuntimeAssetsManifest(source).externalFullRuntime.byteLength, 360_434)
  const parenthesized = manifestSource()
    .replace('ONNX_RUNTIME_ASSETS = {', 'ONNX_RUNTIME_ASSETS = ({')
    .replace('} as const\n', '} as const)\n')
  assert.equal(parseOnnxRuntimeAssetsManifest(parenthesized).externalFullRuntime.byteLength, 360_434)
})

test('rejects runtime evaluation after complete root and property initializers', () => {
  const original = manifestSource()
  for (const suffix of ['.bundleAsset', "['bundleAsset']", ' || {}', ' ? {} : {}', ' as const || {}']) {
    assert.throws(
      () => parseOnnxRuntimeAssetsManifest(original.replace('} as const\n', `}${suffix}\n`)),
      /expected a static literal/,
      suffix,
    )
  }
  for (const expression of ['360_434 + 1', '360_434e1', "'360434'", '-1']) {
    const source = original.replace('byteLength: 360_434', `byteLength: ${expression}`)
    assert.throws(() => parseOnnxRuntimeAssetsManifest(source), /Invalid|exceeds/, expression)
  }
  assert.throws(
    () =>
      parseOnnxRuntimeAssetsManifest(
        original.replace('  },\n  bundleAsset:', '  }.externalFullRuntime,\n  bundleAsset:'),
      ),
    /expected a static literal/,
  )
})

test('rejects spreads, computed properties, getters, shorthand, and duplicates at every object boundary', () => {
  for (const extra of [
    '...{ byteLength: 1 },',
    "['byteLength']: 1,",
    'get byteLength() { return 1 },',
    'byteLength,',
    'byteLength: 1,',
    '__proto__: {},',
  ]) {
    const source = manifestSource().replace('    byteLength: 360_434,', `    byteLength: 360_434,\n    ${extra}`)
    assert.throws(() => parseOnnxRuntimeAssetsManifest(source), /expected a direct property|duplicate or special/)
  }
  const rootSpread = manifestSource().replace('} as const', '  ...{},\n} as const')
  assert.throws(() => parseOnnxRuntimeAssetsManifest(rootSpread), /expected a direct property/)
})

test('rejects missing, duplicated, mutable, and malformed manifest declarations', () => {
  for (const source of [
    '',
    `${manifestSource()}\n${manifestSource()}`,
    manifestSource().replace('export const ', 'export let '),
    'export const ONNX_RUNTIME_ASSETS;',
    'export const ONNX_RUNTIME_ASSETS = {',
    "export const ONNX_RUNTIME_ASSETS = 'not an object'",
    'function example() { const ONNX_RUNTIME_ASSETS = {} }\n',
  ]) {
    assert.throws(() => parseOnnxRuntimeAssetsManifest(source), /ONNX_RUNTIME_ASSETS/)
  }
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
  assert.throws(
    () =>
      parseOnnxRuntimeAssetsManifest(
        manifestSource().replace('ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.mjs'),
      ),
    /External ONNX Runtime JSEP MJS URL drift/,
  )
})

test('rejects an invalid or over-budget external JSEP MJS integrity contract', () => {
  assert.throws(
    () =>
      parseOnnxRuntimeAssetsManifest(manifestSource().replace(`mjsSha256: '${'e'.repeat(64)}'`, "mjsSha256: 'bad'")),
    /externalFullRuntime\.mjs\.sha256/,
  )
  assert.throws(
    () =>
      parseOnnxRuntimeAssetsManifest(manifestSource().replace('mjsMaxByteLength: 64_000', 'mjsMaxByteLength: 40_000')),
    /external full runtime JSEP MJS exceeds mjsMaxByteLength/,
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
    mjsUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.mjs',
    mjsByteLength: 46_614,
    mjsSha256: '${'e'.repeat(64)}',
    mjsMaxByteLength: 64_000,
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
