import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import { URL } from 'node:url'
import { readOnnxRuntimeAssetsManifest, sha256Hex } from './onnx-runtime-assets.mjs'

async function verifyRemoteAsset(url, expected, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is not available for ONNX Runtime CDN verification')
  }

  const response = await fetchImpl(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`ONNX Runtime CDN asset failed: ${url} HTTP ${response.status}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength !== expected.byteLength) {
    throw new Error(`ONNX Runtime CDN asset size mismatch: ${url}`)
  }
  if (sha256Hex(bytes) !== expected.sha256) {
    throw new Error(`ONNX Runtime CDN asset SHA-256 mismatch: ${url}`)
  }
}

async function verifyOnnxRuntimeCdn({ repoRoot = defaultRepoRoot(), fetchImpl = globalThis.fetch } = {}) {
  const manifest = await readOnnxRuntimeAssetsManifest(repoRoot)
  await verifyRemoteAsset(manifest.cdn.scriptUrl, manifest.scriptAsset, fetchImpl)
  for (const asset of manifest.wasmAssets) {
    await verifyRemoteAsset(new URL(asset.filename, manifest.cdn.wasmPath).href, asset, fetchImpl)
  }
}

function defaultRepoRoot() {
  return resolve(import.meta.dirname, '../../..')
}

function isDirectRun() {
  return process.argv[1] ? resolve(process.argv[1]) === import.meta.filename : false
}

if (isDirectRun()) {
  try {
    await verifyOnnxRuntimeCdn()
    process.stdout.write('ONNX Runtime CDN verification passed\n')
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

export { verifyOnnxRuntimeCdn, verifyRemoteAsset }
