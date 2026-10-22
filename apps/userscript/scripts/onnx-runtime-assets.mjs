import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

const manifestRelativePath = 'apps/userscript/src/inference/onnx-runtime-assets.ts'

function readStaticValue(node, context, sourcePath) {
  if (
    ts.isParenthesizedExpression(node) ||
    (ts.isAsExpression(node) &&
      ts.isTypeReferenceNode(node.type) &&
      ts.isIdentifier(node.type.typeName) &&
      node.type.typeName.text === 'const' &&
      !node.type.typeArguments?.length)
  ) {
    return readStaticValue(node.expression, context, sourcePath)
  }
  if (ts.isStringLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (!ts.isObjectLiteralExpression(node)) {
    throw new Error(`Invalid ${context} in ${sourcePath}: expected a static literal`)
  }
  const value = Object.create(null)
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) {
      throw new Error(`Invalid ${context} in ${sourcePath}: expected a direct property`)
    }
    const name = property.name.text
    if (name === '__proto__' || Object.hasOwn(value, name)) {
      throw new Error(`Invalid ${context} in ${sourcePath}: duplicate or special property`)
    }
    value[name] = readStaticValue(property.initializer, `${context}.${name}`, sourcePath)
  }
  return value
}

function readManifestRoot(source, sourcePath) {
  const syntax = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  if (syntax.parseDiagnostics.length > 0) throw new Error(`Invalid ONNX_RUNTIME_ASSETS source in ${sourcePath}`)
  let initializer
  for (const statement of syntax.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'ONNX_RUNTIME_ASSETS') continue
      if (initializer) throw new Error(`Duplicate ONNX_RUNTIME_ASSETS in ${sourcePath}`)
      if (!(statement.declarationList.flags & ts.NodeFlags.Const) || !declaration.initializer) {
        throw new Error(`Invalid ONNX_RUNTIME_ASSETS declaration in ${sourcePath}`)
      }
      initializer = declaration.initializer
    }
  }
  if (!initializer) throw new Error(`Unable to read ONNX_RUNTIME_ASSETS from ${sourcePath}`)
  // Parse the entire initializer: a valid-looking prefix must never hide a
  // runtime suffix, spread, or getter that changes the shipped asset identity.
  return requireObject(readStaticValue(initializer, 'ONNX_RUNTIME_ASSETS', sourcePath), 'ONNX_RUNTIME_ASSETS')
}

function requireObject(value, context) {
  if (!value || typeof value !== 'object') throw new Error(`Unable to read ${context}`)
  return value
}

function readString(source, property, context) {
  const value = source[property]
  if (typeof value !== 'string' || !value) throw new Error(`Unable to read ${context}.${property}`)
  return value
}

function readInteger(source, property, context) {
  const value = source[property]
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${context}.${property}`)
  return value
}

function readAsset(source, property, stringFields) {
  const context = `ONNX_RUNTIME_ASSETS.${property}`
  const block = requireObject(source[property], context)
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
  const root = readManifestRoot(source, sourcePath)
  const externalRuntimeBlock = requireObject(root.externalFullRuntime, 'ONNX_RUNTIME_ASSETS.externalFullRuntime')
  const externalFullRuntime = {
    ...readAsset(root, 'externalFullRuntime', ['scriptUrl', 'wasmBaseUrl', 'mjsUrl', 'wasmUrl']),
    mjsByteLength: readInteger(externalRuntimeBlock, 'mjsByteLength', 'ONNX_RUNTIME_ASSETS.externalFullRuntime'),
    mjsSha256: readString(externalRuntimeBlock, 'mjsSha256', 'ONNX_RUNTIME_ASSETS.externalFullRuntime'),
    mjsMaxByteLength: readInteger(externalRuntimeBlock, 'mjsMaxByteLength', 'ONNX_RUNTIME_ASSETS.externalFullRuntime'),
    wasmByteLength: readInteger(externalRuntimeBlock, 'wasmByteLength', 'ONNX_RUNTIME_ASSETS.externalFullRuntime'),
    wasmSha256: readString(externalRuntimeBlock, 'wasmSha256', 'ONNX_RUNTIME_ASSETS.externalFullRuntime'),
    wasmMaxByteLength: readInteger(
      externalRuntimeBlock,
      'wasmMaxByteLength',
      'ONNX_RUNTIME_ASSETS.externalFullRuntime',
    ),
  }
  const bundleAsset = readAsset(root, 'bundleAsset', ['path', 'filename'])
  const wasmAsset = readAsset(root, 'wasmAsset', ['filename', 'publicPath', 'url', 'objectKey'])
  const manifest = {
    packageName: readString(root, 'packageName', 'ONNX_RUNTIME_ASSETS'),
    packageVersion: readString(root, 'packageVersion', 'ONNX_RUNTIME_ASSETS'),
    sourceCommit: readString(root, 'sourceCommit', 'ONNX_RUNTIME_ASSETS'),
    emsdkVersion: readString(root, 'emsdkVersion', 'ONNX_RUNTIME_ASSETS'),
    operatorConfigSha256: readString(root, 'operatorConfigSha256', 'ONNX_RUNTIME_ASSETS'),
    externalFullRuntime,
    bundleAsset,
    wasmAsset,
  }
  assertSha256(externalFullRuntime.sha256, 'ONNX_RUNTIME_ASSETS.externalFullRuntime')
  assertSha256(externalFullRuntime.mjsSha256, 'ONNX_RUNTIME_ASSETS.externalFullRuntime.mjs')
  assertSha256(externalFullRuntime.wasmSha256, 'ONNX_RUNTIME_ASSETS.externalFullRuntime.wasm')
  assertSha256(bundleAsset.sha256, 'ONNX_RUNTIME_ASSETS.bundleAsset')
  assertSha256(wasmAsset.sha256, 'ONNX_RUNTIME_ASSETS.wasmAsset')
  if (externalFullRuntime.byteLength > externalFullRuntime.maxByteLength) {
    throw new Error('ONNX Runtime external full runtime exceeds maxByteLength')
  }
  if (externalFullRuntime.mjsByteLength > externalFullRuntime.mjsMaxByteLength) {
    throw new Error('ONNX Runtime external full runtime JSEP MJS exceeds mjsMaxByteLength')
  }
  if (externalFullRuntime.wasmByteLength > externalFullRuntime.wasmMaxByteLength) {
    throw new Error('ONNX Runtime external full runtime WASM exceeds wasmMaxByteLength')
  }
  if (bundleAsset.byteLength > bundleAsset.maxByteLength) throw new Error('ONNX Runtime bundle exceeds maxByteLength')
  if (wasmAsset.byteLength > wasmAsset.maxByteLength) throw new Error('ONNX Runtime WASM exceeds maxByteLength')
  if (!wasmAsset.filename.includes(wasmAsset.sha256))
    throw new Error('ONNX Runtime WASM filename is not content-addressed')
  if (wasmAsset.publicPath !== `/${wasmAsset.objectKey}`) throw new Error('ONNX Runtime WASM path/object key mismatch')
  if (wasmAsset.url !== `https://models.ngnl.host${wasmAsset.publicPath}`)
    throw new Error('ONNX Runtime WASM URL drift')
  const expectedExternalBaseUrl = `https://cdn.jsdelivr.net/npm/${manifest.packageName}@${manifest.packageVersion}/dist/`
  if (manifest.externalFullRuntime.scriptUrl !== `${expectedExternalBaseUrl}ort.min.js`) {
    throw new Error('External ONNX Runtime script URL drift')
  }
  if (manifest.externalFullRuntime.wasmBaseUrl !== expectedExternalBaseUrl) {
    throw new Error('External ONNX Runtime WASM base URL drift')
  }
  if (manifest.externalFullRuntime.mjsUrl !== `${expectedExternalBaseUrl}ort-wasm-simd-threaded.jsep.mjs`) {
    throw new Error('External ONNX Runtime JSEP MJS URL drift')
  }
  if (manifest.externalFullRuntime.wasmUrl !== `${expectedExternalBaseUrl}ort-wasm-simd-threaded.jsep.wasm`) {
    throw new Error('External ONNX Runtime WASM URL drift')
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
