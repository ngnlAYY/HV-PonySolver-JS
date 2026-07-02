import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDir, '..')
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs'])
const allowedSinks = new Map([
  ['apps/userscript/src/status-panel/status-panel.ts', { innerHTML: 1 }],
  ['apps/userscript/src/inference/onnx-worker-entry.ts', { 'new Function': 1, importScripts: 1 }],
])

if (isDirectRun()) {
  try {
    const { repoRoot, explicitRepoRoot } = parseArgs(process.argv.slice(2))
    await checkBrowserSinks(repoRoot, { requireSourceDir: explicitRepoRoot })
    process.stdout.write('Browser sink check passed\n')
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

function isDirectRun() {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
}

function parseArgs(args) {
  const repoRootIndex = args.indexOf('--repo-root')
  if (repoRootIndex === -1) {
    return { repoRoot: defaultRepoRoot, explicitRepoRoot: false }
  }
  const repoRoot = args[repoRootIndex + 1]
  if (!repoRoot) {
    throw new Error('--repo-root requires a path')
  }
  return { repoRoot: resolve(repoRoot), explicitRepoRoot: true }
}

async function checkBrowserSinks(repoRoot = defaultRepoRoot, { requireSourceDir = false } = {}) {
  const userscriptDir = resolve(repoRoot, 'apps/userscript/src')
  if (!existsSync(userscriptDir)) {
    if (requireSourceDir) {
      throw new Error('apps/userscript/src is missing')
    }
    return
  }

  const violations = []
  for (const file of await collectSourceFiles(userscriptDir)) {
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

  if (violations.length > 0) {
    throw new Error(violations.join('\n'))
  }
}

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(path))
      continue
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      files.push(path)
    }
  }
  return files
}

function findSinkKinds(source, fileName = 'browser-sink-source.ts') {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, readScriptKind(fileName))
  const sinks = []

  function visit(node) {
    if (isInnerHtmlAssignment(node)) {
      sinks.push('innerHTML')
    } else if (isNewFunctionCall(node)) {
      sinks.push('new Function')
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
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function isInnerHtmlAssignment(node) {
  return (
    ts.isBinaryExpression(node)
    && isAssignmentOperator(node.operatorToken.kind)
    && isInnerHtmlTarget(node.left)
  )
}

function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
}

function isInnerHtmlTarget(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === 'innerHTML'
  }
  return ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'innerHTML'
}

function isNewFunctionCall(node) {
  return (
    ts.isNewExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'Function'
  )
}

function isImportScriptsCall(node) {
  return (
    ts.isCallExpression(node)
    && isImportScriptsExpression(node.expression)
  )
}

function isImportScriptsExpression(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text === 'importScripts'
  }
  return ts.isPropertyAccessExpression(expression) && expression.name.text === 'importScripts'
}

export { allowedSinks, checkBrowserSinks, findSinkKinds }
