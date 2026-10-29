import ts from 'typescript'

import { isIdentifierPart, skipIgnoredSyntaxAndRegexLiteral, skipWhitespaceAndComments } from './source-syntax.mjs'

const parsedSources = new Map()
const MAX_PARSED_SOURCES = 8

function parseTypeScriptSource(source) {
  let sourceFile = parsedSources.get(source)
  if (!sourceFile) {
    sourceFile = ts.createSourceFile('docs-drift-source.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
    if (parsedSources.size >= MAX_PARSED_SOURCES) parsedSources.delete(parsedSources.keys().next().value)
    parsedSources.set(source, sourceFile)
  }
  return sourceFile
}

function readConstInitializer(sourceFile, constantName) {
  if (sourceFile.parseDiagnostics.length > 0) return null
  let initializer
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== constantName) continue
      if (initializer || !(statement.declarationList.flags & ts.NodeFlags.Const) || !declaration.initializer)
        return null
      initializer = declaration.initializer
    }
  }
  // Only type assertions and parentheses may wrap the complete literal initializer.
  while (
    initializer &&
    (ts.isAsExpression(initializer) ||
      ts.isTypeAssertionExpression(initializer) ||
      ts.isSatisfiesExpression(initializer) ||
      ts.isParenthesizedExpression(initializer))
  ) {
    initializer = initializer.expression
  }
  return initializer ?? null
}

function readConstStringLiteral(source, constantName) {
  const sourceFile = parseTypeScriptSource(source)
  const initializer = readConstInitializer(sourceFile, constantName)
  return initializer && ts.isStringLiteral(initializer) ? initializer.text : null
}

function readConstRegexLiteral(source, constantName) {
  const sourceFile = parseTypeScriptSource(source)
  const initializer = readConstInitializer(sourceFile, constantName)
  return initializer && ts.isRegularExpressionLiteral(initializer) ? initializer.getText(sourceFile) : null
}

function readFunctionBodySource(source, functionName) {
  const sourceFile = parseTypeScriptSource(source)
  if (sourceFile.parseDiagnostics.length > 0) return ''
  let body
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name?.text !== functionName || !statement.body) continue
    if (body) return ''
    body = statement.body
  }
  return body ? source.slice(body.getStart(sourceFile) + 1, body.end - 1) : ''
}

function extractStringCallArgumentsFromCode(source, callee) {
  const values = []
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (
      !source.startsWith(callee, index) ||
      isIdentifierPart(source[index - 1]) ||
      isIdentifierPart(source[index + callee.length])
    ) {
      continue
    }

    const openParenIndex = skipWhitespaceAndComments(source, index + callee.length)
    if (source[openParenIndex] !== '(') {
      continue
    }
    const argumentStart = skipWhitespaceAndComments(source, openParenIndex + 1)
    const parsed = parseStringLiteral(source, argumentStart)
    if (!parsed) {
      continue
    }
    const argumentEnd = skipWhitespaceAndComments(source, parsed.end)
    if (source[argumentEnd] === ')') {
      values.push(parsed.value)
    }
    index = parsed.end - 1
  }
  return values
}

function readIdentifierToken(source, startIndex) {
  if (!/[A-Za-z_$]/.test(source[startIndex] ?? '')) {
    return null
  }
  let endIndex = startIndex + 1
  while (isIdentifierPart(source[endIndex])) {
    endIndex += 1
  }
  return source.slice(startIndex, endIndex)
}

function parseStringLiteral(source, valueStart) {
  const quote = source[valueStart]
  if (quote !== "'" && quote !== '"') {
    return null
  }
  let invalid = false
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
    () => {
      invalid = true
    },
    valueStart,
  )
  const token = scanner.scan()
  return token === ts.SyntaxKind.StringLiteral && !invalid && !scanner.isUnterminated()
    ? { value: scanner.getTokenValue(), end: scanner.getTextPos() }
    : null
}

export {
  extractStringCallArgumentsFromCode,
  parseStringLiteral,
  readConstRegexLiteral,
  readConstStringLiteral,
  readFunctionBodySource,
  readIdentifierToken,
}
