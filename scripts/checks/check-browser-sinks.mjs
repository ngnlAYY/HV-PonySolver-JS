import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parseRepoRootArgs } from '../lib/cli.mjs'
import { isDirectRun } from '../lib/direct-run.mjs'
import { collectSourceFiles } from '../lib/source-files.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDir, '../..')
const browserSourceDirs = ['apps/userscript/src', 'packages/browser-core/src', 'apps/extension/src']
const allowedSinks = new Map([['apps/userscript/src/inference/onnx-worker-external-entry.ts', { importScripts: 1 }]])

if (isDirectRun(import.meta.url)) {
  try {
    const { repoRoot } = parseRepoRootArgs(process.argv.slice(2), defaultRepoRoot)
    await checkBrowserSinks(repoRoot, { requireSourceDir: true })
    process.stdout.write('Browser sink check passed\n')
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

async function checkBrowserSinks(repoRoot = defaultRepoRoot, { requireSourceDir = false } = {}) {
  const violations = []
  const missingSourceDirs = []
  for (const sourceDir of browserSourceDirs) {
    const absoluteDir = resolve(repoRoot, sourceDir)
    if (!existsSync(absoluteDir)) {
      missingSourceDirs.push(sourceDir)
      continue
    }
    for (const file of await collectSourceFiles(absoluteDir)) {
      const relativePath = relative(repoRoot, file).replaceAll('\\', '/')
      const allowed = { ...(allowedSinks.get(relativePath) ?? {}) }
      const source = await readFile(file, 'utf8')
      for (const kind of findSinkKinds(source, file)) {
        if (!allowed[kind]) {
          violations.push(`unexpected ${kind} sink: ${relativePath}`)
          continue
        }
        allowed[kind] -= 1
      }
    }
  }

  if (requireSourceDir && missingSourceDirs.length > 0) {
    throw new Error(`browser sink source directories are missing: ${missingSourceDirs.join(', ')}`)
  }

  if (violations.length > 0) {
    throw new Error(violations.join('\n'))
  }
}

function findSinkKinds(source, fileName = 'browser-sink-source.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, readScriptKind(fileName))
  const sinks = []

  function visit(node) {
    if (isInnerHtmlAssignment(node)) {
      sinks.push('innerHTML')
    } else if (isFunctionConstructorCall(node)) {
      sinks.push('Function')
    } else if (isImportScriptsCall(node)) {
      sinks.push('importScripts')
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return sinks
}

function readScriptKind(fileName) {
  switch (extname(fileName)) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function isInnerHtmlAssignment(node) {
  return ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind) && isInnerHtmlTarget(node.left)
}

function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
}

function isInnerHtmlTarget(node) {
  return readPropertyName(unwrapExpression(node)) === 'innerHTML'
}

function isFunctionConstructorCall(node) {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return false
  const expression = unwrapExpression(node.expression)
  if (ts.isIdentifier(expression)) return expression.text === 'Function'
  if (readPropertyName(expression) !== 'Function') return false
  const receiver = unwrapExpression(expression.expression)
  return ts.isIdentifier(receiver) && ['globalThis', 'window', 'self'].includes(receiver.text)
}

function isImportScriptsCall(node) {
  return ts.isCallExpression(node) && isImportScriptsExpression(node.expression)
}

function isImportScriptsExpression(expression) {
  expression = unwrapExpression(expression)
  return ts.isIdentifier(expression)
    ? expression.text === 'importScripts'
    : readPropertyName(expression) === 'importScripts'
}

function readPropertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) {
    return expression.argumentExpression.text
  }
  return null
}

function unwrapExpression(expression) {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression
  }
  return expression
}

export { allowedSinks, browserSourceDirs, checkBrowserSinks, findSinkKinds }
