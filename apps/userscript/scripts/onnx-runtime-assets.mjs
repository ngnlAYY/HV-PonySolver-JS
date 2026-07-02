import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const defaultManifestRelativePath = 'apps/userscript/src/inference/onnx-runtime-assets.ts'
const defaultRepoRoot = resolve(import.meta.dirname, '../../..')

function parseOnnxRuntimeAssetsManifest(source, options = {}) {
  const sourcePath = options.sourcePath ?? defaultManifestRelativePath
  const manifestSource = extractOnnxRuntimeAssetsObjectSource(source, sourcePath)
  const scriptAssetSource = parseObjectProperty(manifestSource, 'scriptAsset', 'scriptAsset', sourcePath)
  const cdnSource = parseObjectProperty(manifestSource, 'cdn', 'cdn', sourcePath)
  const scriptAsset = {
    ...parseAssetObject(scriptAssetSource, 'scriptAsset', sourcePath),
    maxByteLength: parseNumberProperty(scriptAssetSource, 'maxByteLength', 'scriptAsset.maxByteLength', sourcePath),
  }
  const wasmAssetsSource = parseArrayProperty(manifestSource, 'wasmAssets', 'wasmAssets', sourcePath)
  const wasmAssets = parseAssetArray(wasmAssetsSource, 'wasmAssets', sourcePath)

  const manifest = {
    packageName: parseStringProperty(manifestSource, 'packageName', 'packageName', sourcePath),
    packageVersion: parseStringProperty(manifestSource, 'packageVersion', 'packageVersion', sourcePath),
    scriptAsset,
    wasmAssets,
    cdn: {
      scriptUrl: parseStringProperty(cdnSource, 'scriptUrl', 'cdn.scriptUrl', sourcePath),
      wasmPath: parseStringProperty(cdnSource, 'wasmPath', 'cdn.wasmPath', sourcePath),
    },
  }
  validateOnnxRuntimeCdn(manifest, sourcePath)
  return manifest
}

async function readOnnxRuntimeAssetsManifest(repoRoot = defaultRepoRoot, options = {}) {
  const relativePath = options.relativePath ?? defaultManifestRelativePath
  const manifestPath = resolve(repoRoot, relativePath)
  const source = await readFile(manifestPath, 'utf8')
  return parseOnnxRuntimeAssetsManifest(source, { sourcePath: manifestPath })
}

function resolveInstalledOnnxRuntimeAssetPath(manifest, repoRoot = defaultRepoRoot) {
  return resolveInstalledOnnxRuntimeAssetPathCandidates(manifest, repoRoot)[0]
}

function resolveInstalledOnnxRuntimeAssetPathCandidates(manifest, repoRoot = defaultRepoRoot) {
  return resolveInstalledOnnxRuntimePackageAssetPathCandidates(manifest, manifest.scriptAsset, repoRoot)
}

function resolveInstalledOnnxRuntimePackageAssetPathCandidates(manifest, asset, repoRoot = defaultRepoRoot) {
  return [
    resolve(repoRoot, 'node_modules', manifest.packageName, asset.path),
    resolve(repoRoot, 'apps/userscript/node_modules', manifest.packageName, asset.path),
  ]
}

async function readFirstExistingOnnxRuntimeAssetStats(filePaths) {
  const missingPaths = []
  for (const filePath of filePaths) {
    try {
      return { filePath, stats: await readOnnxRuntimeAssetStats(filePath) }
    } catch (error) {
      if (!isMissingAssetError(error)) {
        throw error
      }
      missingPaths.push(resolve(filePath))
    }
  }

  throw new Error(`ONNX Runtime asset does not exist in any checked location: ${missingPaths.join(', ')}`)
}

async function readOnnxRuntimeAssetStats(filePath) {
  const resolvedPath = resolve(filePath)
  let fileStats
  try {
    fileStats = await stat(resolvedPath)
  } catch {
    throw new Error(`ONNX Runtime asset does not exist: ${resolvedPath}`)
  }
  if (!fileStats.isFile()) {
    throw new Error(`ONNX Runtime asset is not a file: ${resolvedPath}`)
  }
  const bytes = await readFile(resolvedPath)
  return {
    byteLength: bytes.byteLength,
    sha256: sha256Hex(bytes),
  }
}

function onnxRuntimeAssetIntegrityMatches(actual, expected) {
  return actual.byteLength === expected.byteLength && actual.sha256 === expected.sha256
}

function isMissingAssetError(error) {
  return error instanceof Error && error.message.startsWith('ONNX Runtime asset does not exist: ')
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function extractOnnxRuntimeAssetsObjectSource(source, sourcePath) {
  const objectStart = findExportedManifestObjectStart(source)
  if (objectStart === -1) {
    throw new Error(`Unable to read ONNX_RUNTIME_ASSETS from ${sourcePath}`)
  }

  const objectEnd = findMatchingBrace(source, objectStart)
  if (objectEnd === -1) {
    throw new Error(`Unable to read ONNX_RUNTIME_ASSETS from ${sourcePath}`)
  }
  return source.slice(objectStart, objectEnd + 1)
}

function findExportedManifestObjectStart(source) {
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntax(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (!identifierAt(source, index, 'export')) {
      continue
    }

    const constStart = skipWhitespaceAndComments(source, index + 'export'.length)
    const nameStart = skipWhitespaceAndComments(source, constStart + 'const'.length)
    const equalsStart = skipWhitespaceAndComments(source, nameStart + 'ONNX_RUNTIME_ASSETS'.length)
    const objectStart = skipWhitespaceAndComments(source, equalsStart + 1)
    if (identifierAt(source, constStart, 'const')
      && identifierAt(source, nameStart, 'ONNX_RUNTIME_ASSETS')
      && source[equalsStart] === '='
      && source[objectStart] === '{') {
      return objectStart
    }
  }
  return -1
}

function findMatchingBrace(source, objectStart) {
  let depth = 0
  for (let index = objectStart; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntax(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }

    if (source[index] === '{') {
      depth += 1
      continue
    }
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

function parseObjectProperty(source, propertyName, displayName, sourcePath) {
  const match = readSinglePropertyMatch(source, propertyName, displayName, sourcePath)
  const objectStart = match.valueStart
  if (source[objectStart] !== '{') {
    throw new Error(`Unable to read ONNX_RUNTIME_ASSETS.${displayName} from ${sourcePath}`)
  }

  const objectEnd = findMatchingBrace(source, objectStart)
  if (objectEnd === -1) {
    throw new Error(`Unable to read ONNX_RUNTIME_ASSETS.${displayName} from ${sourcePath}`)
  }
  assertPropertyValueTerminator(source, objectEnd + 1, displayName, sourcePath)
  return source.slice(objectStart, objectEnd + 1)
}

function parseArrayProperty(source, propertyName, displayName, sourcePath) {
  const match = readSinglePropertyMatch(source, propertyName, displayName, sourcePath)
  const arrayStart = match.valueStart
  if (source[arrayStart] !== '[') {
    throw new Error(`Unable to read ONNX_RUNTIME_ASSETS.${displayName} from ${sourcePath}`)
  }

  const arrayEnd = findMatchingBracket(source, arrayStart)
  if (arrayEnd === -1) {
    throw new Error(`Unable to read ONNX_RUNTIME_ASSETS.${displayName} from ${sourcePath}`)
  }
  assertPropertyValueTerminator(source, arrayEnd + 1, displayName, sourcePath)
  return source.slice(arrayStart, arrayEnd + 1)
}

function parseAssetArray(source, displayName, sourcePath) {
  const assets = []
  for (let index = 1; index < source.length - 1; index += 1) {
    const skipped = skipIgnoredSyntax(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (/\s|,/.test(source[index])) {
      continue
    }
    if (source[index] !== '{') {
      throw new Error(`Invalid ONNX_RUNTIME_ASSETS.${displayName} in ${sourcePath}: unexpected array item`)
    }

    const objectEnd = findMatchingBrace(source, index)
    if (objectEnd === -1) {
      throw new Error(`Unable to read ONNX_RUNTIME_ASSETS.${displayName} from ${sourcePath}`)
    }
    assets.push(parseAssetObject(source.slice(index, objectEnd + 1), `${displayName}[${assets.length}]`, sourcePath))
    index = objectEnd
  }

  if (assets.length === 0) {
    throw new Error(`ONNX_RUNTIME_ASSETS.${displayName} must include at least one asset`)
  }
  return assets
}

function parseAssetObject(assetSource, displayName, sourcePath) {
  const sha256 = parseStringProperty(assetSource, 'sha256', `${displayName}.sha256`, sourcePath)
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`Invalid ONNX_RUNTIME_ASSETS.${displayName}.sha256 in ${sourcePath}: ${sha256}`)
  }

  return {
    path: parseStringProperty(assetSource, 'path', `${displayName}.path`, sourcePath),
    filename: parseStringProperty(assetSource, 'filename', `${displayName}.filename`, sourcePath),
    byteLength: parseNumberProperty(assetSource, 'byteLength', `${displayName}.byteLength`, sourcePath),
    sha256,
  }
}

function findMatchingBracket(source, arrayStart) {
  let depth = 0
  for (let index = arrayStart; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntax(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }

    if (source[index] === '[') {
      depth += 1
      continue
    }
    if (source[index] === ']') {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }

  return -1
}

function validateOnnxRuntimeCdn(manifest, sourcePath) {
  const expected = expectedOnnxRuntimeCdn(manifest)
  if (manifest.cdn.scriptUrl !== expected.scriptUrl) {
    throw new Error(
      `Invalid ONNX_RUNTIME_ASSETS.cdn.scriptUrl in ${sourcePath}: expected ${expected.scriptUrl}, got ${manifest.cdn.scriptUrl}`,
    )
  }
  if (manifest.cdn.wasmPath !== expected.wasmPath) {
    throw new Error(
      `Invalid ONNX_RUNTIME_ASSETS.cdn.wasmPath in ${sourcePath}: expected ${expected.wasmPath}, got ${manifest.cdn.wasmPath}`,
    )
  }
}

function expectedOnnxRuntimeCdn(manifest) {
  const scriptDirectory = manifest.scriptAsset.path.slice(0, manifest.scriptAsset.path.lastIndexOf('/') + 1)
  const packageBaseUrl = `https://cdn.jsdelivr.net/npm/${manifest.packageName}@${manifest.packageVersion}/`
  return {
    scriptUrl: `${packageBaseUrl}${manifest.scriptAsset.path}`,
    wasmPath: `${packageBaseUrl}${scriptDirectory}`,
  }
}

function parseStringProperty(source, propertyName, displayName, sourcePath) {
  const match = readSinglePropertyMatch(source, propertyName, displayName, sourcePath)
  const parsed = parseStringLiteral(source, match.valueStart)
  if (!parsed?.value) {
    throw new Error(`Unable to read ONNX_RUNTIME_ASSETS.${displayName} from ${sourcePath}`)
  }
  assertPropertyValueTerminator(source, parsed.end, displayName, sourcePath)
  return parsed.value
}

function parseNumberProperty(source, propertyName, displayName, sourcePath) {
  const match = readSinglePropertyMatch(source, propertyName, displayName, sourcePath)
  const tokenEnd = readNumberTokenEnd(source, match.valueStart)
  const token = source.slice(match.valueStart, tokenEnd)
  if (!token) {
    throw new Error(`Unable to read ONNX_RUNTIME_ASSETS.${displayName} from ${sourcePath}`)
  }
  if (!/^[0-9]+(?:_[0-9]+)*$/.test(token)) {
    throw new Error(`Invalid ONNX_RUNTIME_ASSETS.${displayName} in ${sourcePath}: ${token}`)
  }
  assertPropertyValueTerminator(source, tokenEnd, displayName, sourcePath)
  const value = Number(token.replaceAll('_', ''))
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Invalid ONNX_RUNTIME_ASSETS.${displayName} in ${sourcePath}: ${token}`)
  }
  return value
}

function readSinglePropertyMatch(source, propertyName, displayName, sourcePath) {
  const matches = findDirectPropertyMatches(source, propertyName)
  if (matches.length === 0) {
    throw new Error(`Unable to read ONNX_RUNTIME_ASSETS.${displayName} from ${sourcePath}`)
  }
  if (matches.length > 1) {
    throw new Error(`Duplicate ONNX_RUNTIME_ASSETS.${displayName} in ${sourcePath}`)
  }
  return matches[0]
}

function findDirectPropertyMatches(source, propertyName) {
  const matches = []
  let depth = 0
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntax(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }

    const char = source[index]
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      continue
    }
    if (depth !== 1 || !isIdentifierStart(char)) {
      continue
    }

    const nameEnd = readIdentifierEnd(source, index + 1)
    const colonIndex = skipWhitespaceAndComments(source, nameEnd)
    if (source[colonIndex] === ':' && source.slice(index, nameEnd) === propertyName) {
      matches.push({ index, valueStart: skipWhitespaceAndComments(source, colonIndex + 1) })
    }
    index = nameEnd - 1
  }
  return matches
}

function parseStringLiteral(source, valueStart) {
  const quote = source[valueStart]
  if (quote !== '\'' && quote !== '"') {
    return null
  }

  let value = ''
  let isEscaped = false
  for (let index = valueStart + 1; index < source.length; index += 1) {
    const char = source[index]
    if (isEscaped) {
      value += char
      isEscaped = false
    } else if (char === '\\') {
      value += char
      isEscaped = true
    } else if (char === quote) {
      return { value, end: index + 1 }
    } else if (char === '\n' || char === '\r') {
      return null
    } else {
      value += char
    }
  }
  return null
}

function readNumberTokenEnd(source, valueStart) {
  let index = valueStart
  while (/[0-9_]/.test(source[index] ?? '')) {
    index += 1
  }
  return index
}

function assertPropertyValueTerminator(source, valueEnd, displayName, sourcePath) {
  const terminatorIndex = skipWhitespaceAndComments(source, valueEnd)
  const terminator = source[terminatorIndex]
  if (terminator !== ',' && terminator !== '}') {
    throw new Error(`Invalid ONNX_RUNTIME_ASSETS.${displayName} in ${sourcePath}: unexpected token after literal value`)
  }
}

function skipIgnoredSyntax(source, index) {
  const char = source[index]
  const nextChar = source[index + 1]
  if (char === '/' && nextChar === '/') {
    return skipLineComment(source, index)
  }
  if (char === '/' && nextChar === '*') {
    return skipBlockComment(source, index)
  }
  if (char === '\'' || char === '"' || char === '`') {
    return skipQuotedLiteral(source, index)
  }
  return index
}

function skipWhitespaceAndComments(source, startIndex) {
  let index = startIndex
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1
      continue
    }
    const skipped = skipIgnoredComment(source, index)
    if (skipped === index) {
      return index
    }
    index = skipped
  }
  return index
}

function skipIgnoredComment(source, index) {
  const char = source[index]
  const nextChar = source[index + 1]
  if (char === '/' && nextChar === '/') {
    return skipLineComment(source, index)
  }
  if (char === '/' && nextChar === '*') {
    return skipBlockComment(source, index)
  }
  return index
}

function skipLineComment(source, startIndex) {
  const endIndex = source.indexOf('\n', startIndex + 2)
  return endIndex === -1 ? source.length : endIndex + 1
}

function skipBlockComment(source, startIndex) {
  const endIndex = source.indexOf('*/', startIndex + 2)
  return endIndex === -1 ? source.length : endIndex + 2
}

function skipQuotedLiteral(source, startIndex) {
  let isEscaped = false
  const quote = source[startIndex]
  for (let index = startIndex + 1; index < source.length; index += 1) {
    if (isEscaped) {
      isEscaped = false
    } else if (source[index] === '\\') {
      isEscaped = true
    } else if (source[index] === quote) {
      return index + 1
    }
  }
  return source.length
}

function identifierAt(source, index, identifier) {
  return source.startsWith(identifier, index)
    && !isIdentifierPart(source[index - 1])
    && !isIdentifierPart(source[index + identifier.length])
}

function readIdentifierEnd(source, startIndex) {
  let index = startIndex
  while (isIdentifierPart(source[index])) {
    index += 1
  }
  return index
}

function isIdentifierStart(char) {
  return /[A-Za-z_$]/.test(char ?? '')
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_$]/.test(char ?? '')
}

export {
  defaultManifestRelativePath,
  defaultRepoRoot,
  onnxRuntimeAssetIntegrityMatches,
  parseOnnxRuntimeAssetsManifest,
  readFirstExistingOnnxRuntimeAssetStats,
  readOnnxRuntimeAssetsManifest,
  readOnnxRuntimeAssetStats,
  resolveInstalledOnnxRuntimeAssetPath,
  resolveInstalledOnnxRuntimeAssetPathCandidates,
  resolveInstalledOnnxRuntimePackageAssetPathCandidates,
  sha256Hex,
}
