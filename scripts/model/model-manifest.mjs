import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

const defaultManifestRelativePath = 'packages/shared/src/model.ts'

function parseByteLength(value, sourcePath) {
  if (!/^[0-9]+(?:_[0-9]+)*$/.test(value)) {
    throw new Error(`Invalid MODEL_INTEGRITY.byteLength in ${sourcePath}: ${value}`)
  }
  const parsedValue = Number(value.replaceAll('_', ''))
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Invalid MODEL_INTEGRITY.byteLength in ${sourcePath}: ${value}`)
  }
  return parsedValue
}

function parseModelManifest(modelSource, options = {}) {
  const sourcePath = options.sourcePath ?? defaultManifestRelativePath
  const requireVersion = options.requireVersion ?? true
  const sourceFile = ts.createSourceFile(sourcePath, modelSource, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`Invalid model manifest syntax in ${sourcePath}`)
  }
  const declarations = readManifestDeclarations(sourceFile, sourcePath)
  const versionNode = readLiteralInitializer(
    declarations.get('MODEL_VERSION'),
    ts.isStringLiteral,
    'MODEL_VERSION',
    sourcePath,
  )
  const integrity = readLiteralInitializer(
    declarations.get('MODEL_INTEGRITY'),
    ts.isObjectLiteralExpression,
    'MODEL_INTEGRITY',
    sourcePath,
  )
  const properties = readIntegrityProperties(integrity, sourcePath)
  const version = versionNode?.text ?? null
  const byteLength = readLiteralInitializer(
    properties.get('byteLength'),
    ts.isNumericLiteral,
    'MODEL_INTEGRITY.byteLength',
    sourcePath,
  )
  const sha256 = readLiteralInitializer(
    properties.get('sha256'),
    ts.isStringLiteral,
    'MODEL_INTEGRITY.sha256',
    sourcePath,
  )?.text

  if ((requireVersion || versionNode !== null) && !version) {
    throw new Error(`Unable to read MODEL_VERSION from ${sourcePath}`)
  }
  if (!byteLength) {
    throw new Error(`Unable to read MODEL_INTEGRITY.byteLength from ${sourcePath}`)
  }
  if (!sha256) {
    throw new Error(`Unable to read MODEL_INTEGRITY.sha256 from ${sourcePath}`)
  }
  if (!/^[a-fA-F0-9]{64}$/.test(sha256)) {
    throw new Error(`Invalid MODEL_INTEGRITY.sha256 in ${sourcePath}: ${sha256}`)
  }

  return {
    version,
    byteLength: parseByteLength(byteLength.getText(sourceFile), sourcePath),
    sha256: sha256.toLowerCase(),
  }
}

function readManifestDeclarations(sourceFile, sourcePath) {
  const declarations = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue
      const name = declaration.name.text
      if (name !== 'MODEL_VERSION' && name !== 'MODEL_INTEGRITY') continue
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) {
        throw new Error(`Invalid ${name} in ${sourcePath}: expected a const declaration`)
      }
      if (declarations.has(name)) throw new Error(`Duplicate ${name} in ${sourcePath}`)
      declarations.set(name, declaration)
    }
  }
  return declarations
}

function readLiteralInitializer(declaration, isLiteral, displayName, sourcePath) {
  if (!declaration) return null
  let initializer = declaration.initializer
  // Type assertions and parentheses do not change a literal's runtime value.
  // Inspect the complete initializer so property selection and operators cannot hide a different value.
  while (
    initializer &&
    (ts.isAsExpression(initializer) ||
      ts.isSatisfiesExpression(initializer) ||
      ts.isParenthesizedExpression(initializer))
  ) {
    initializer = initializer.expression
  }
  if (!initializer || !isLiteral(initializer)) {
    throw new Error(`Invalid ${displayName} in ${sourcePath}: unexpected token after literal value`)
  }
  return initializer
}

function readIntegrityProperties(integrity, sourcePath) {
  const properties = new Map()
  if (!integrity) return properties
  for (const property of integrity.properties) {
    // A spread or computed key may override either checked field, even when its name is not statically known.
    if (ts.isSpreadAssignment(property) || (property.name && ts.isComputedPropertyName(property.name))) {
      throw new Error(`Invalid MODEL_INTEGRITY in ${sourcePath}: spread and computed properties are not supported`)
    }
    const name = property.name?.text
    if (name !== 'byteLength' && name !== 'sha256') continue
    if (properties.has(name)) throw new Error(`Duplicate MODEL_INTEGRITY.${name} in ${sourcePath}`)
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(`Invalid MODEL_INTEGRITY.${name} in ${sourcePath}: expected a literal property assignment`)
    }
    properties.set(name, property)
  }
  return properties
}

async function readModelManifest(repoRoot, options = {}) {
  const relativePath = options.relativePath ?? defaultManifestRelativePath
  const manifestPath = resolve(repoRoot, relativePath)
  const source = await readFile(manifestPath, 'utf8')
  return parseModelManifest(source, {
    requireVersion: options.requireVersion,
    sourcePath: manifestPath,
  })
}

export { parseModelManifest, readModelManifest }
