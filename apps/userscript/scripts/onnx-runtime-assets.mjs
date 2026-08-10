import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const manifestRelativePath = 'apps/userscript/src/inference/onnx-runtime-assets.ts'

function extractObject(source, property, sourcePath) {
  const marker = property === 'ONNX_RUNTIME_ASSETS' ? 'ONNX_RUNTIME_ASSETS =' : `${property}:`
  const propertyIndex = source.indexOf(marker)
  const start = source.indexOf('{', propertyIndex)
  if (propertyIndex < 0 || start < 0) throw new Error(`Unable to read ONNX_RUNTIME_ASSETS.${property} from ${sourcePath}`)
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    if (character === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`Unterminated ONNX_RUNTIME_ASSETS.${property} in ${sourcePath}`)
}

function readString(source, property, context) {
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*'([^']+)'\\s*,?`, 'm'))
  if (!match?.[1]) throw new Error(`Unable to read ${context}.${property}`)
  return match[1]
}

function readInteger(source, property, context) {
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*([0-9][0-9_]*)\\s*,?`, 'm'))
  if (!match?.[1]) throw new Error(`Unable to read ${context}.${property}`)
  const value = Number(match[1].replaceAll('_', ''))
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${context}.${property}`)
  return value
}

function readAsset(source, property, sourcePath, stringFields) {
  const context = `ONNX_RUNTIME_ASSETS.${property}`
  const block = extractObject(source, property, sourcePath)
  return {
    ...Object.fromEntries(stringFields.map((field) => [field, readString(block, field, context)])),
    byteLength: readInteger(block, 'byteLength', context),
    sha256: readString(block, 'sha256', context),
    maxByteLength: readInteger(block, 'maxByteLength', context),
  }
}

function assertSha256(value, context) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`Invalid ${context}.sha256`)
}

export function parseOnnxRuntimeAssetsManifest(source, { sourcePath = manifestRelativePath } = {}) {
  const root = extractObject(source, 'ONNX_RUNTIME_ASSETS', sourcePath)
  const externalFullRuntimeBlock = extractObject(root, 'externalFullRuntime', sourcePath)
  const bundleAsset = readAsset(root, 'bundleAsset', sourcePath, ['path', 'filename'])
  const wasmAsset = readAsset(root, 'wasmAsset', sourcePath, ['filename', 'publicPath', 'url', 'objectKey'])
  const manifest = {
    packageName: readString(root, 'packageName', 'ONNX_RUNTIME_ASSETS'),
    packageVersion: readString(root, 'packageVersion', 'ONNX_RUNTIME_ASSETS'),
    sourceCommit: readString(root, 'sourceCommit', 'ONNX_RUNTIME_ASSETS'),
    emsdkVersion: readString(root, 'emsdkVersion', 'ONNX_RUNTIME_ASSETS'),
    operatorConfigSha256: readString(root, 'operatorConfigSha256', 'ONNX_RUNTIME_ASSETS'),
    externalFullRuntime: {
      scriptUrl: readString(externalFullRuntimeBlock, 'scriptUrl', 'ONNX_RUNTIME_ASSETS.externalFullRuntime'),
      wasmBaseUrl: readString(externalFullRuntimeBlock, 'wasmBaseUrl', 'ONNX_RUNTIME_ASSETS.externalFullRuntime'),
    },
    bundleAsset,
    wasmAsset,
  }
  assertSha256(bundleAsset.sha256, 'ONNX_RUNTIME_ASSETS.bundleAsset')
  assertSha256(wasmAsset.sha256, 'ONNX_RUNTIME_ASSETS.wasmAsset')
  if (bundleAsset.byteLength > bundleAsset.maxByteLength) throw new Error('ONNX Runtime bundle exceeds maxByteLength')
  if (wasmAsset.byteLength > wasmAsset.maxByteLength) throw new Error('ONNX Runtime WASM exceeds maxByteLength')
  if (!wasmAsset.filename.includes(wasmAsset.sha256)) throw new Error('ONNX Runtime WASM filename is not content-addressed')
  if (wasmAsset.publicPath !== `/${wasmAsset.objectKey}`) throw new Error('ONNX Runtime WASM path/object key mismatch')
  if (wasmAsset.url !== `https://models.ngnl.host${wasmAsset.publicPath}`) throw new Error('ONNX Runtime WASM URL drift')
  const expectedExternalBaseUrl = `https://cdn.jsdelivr.net/npm/${manifest.packageName}@${manifest.packageVersion}/dist/`
  if (manifest.externalFullRuntime.scriptUrl !== `${expectedExternalBaseUrl}ort.min.js`) {
    throw new Error('External ONNX Runtime script URL drift')
  }
  if (manifest.externalFullRuntime.wasmBaseUrl !== expectedExternalBaseUrl) {
    throw new Error('External ONNX Runtime WASM base URL drift')
  }
  return manifest
}

export async function readOnnxRuntimeAssetsManifest(repoRoot) {
  const sourcePath = resolve(repoRoot, manifestRelativePath)
  return parseOnnxRuntimeAssetsManifest(await readFile(sourcePath, 'utf8'), { sourcePath })
}

export function resolveRuntimeBundlePath(manifest, repoRoot) {
  return resolve(repoRoot, manifest.bundleAsset.path)
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function readAssetStats(filePath) {
  const fileStats = await stat(filePath)
  if (!fileStats.isFile()) throw new Error(`ONNX Runtime asset is not a file: ${filePath}`)
  const bytes = await readFile(filePath)
  return { byteLength: bytes.byteLength, sha256: sha256Hex(bytes) }
}

export function assetIntegrityMatches(actual, expected) {
  return actual.byteLength === expected.byteLength && actual.sha256 === expected.sha256
}
