import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDir, '..')
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx'])

const BOUNDARY_RULES = [
  {
    name: 'inference layer must not import status panel',
    fromDir: 'apps/userscript/src/inference',
    forbiddenImports: ['../status-panel', '/status-panel/', 'src/status-panel'],
  },
  {
    name: 'status panel must not import inference',
    fromDir: 'apps/userscript/src/status-panel',
    forbiddenImports: ['../inference', '/inference/', 'src/inference'],
  },
  {
    name: 'model worker must not import userscript',
    fromDir: 'apps/model-worker/src',
    forbiddenImports: ['apps/userscript', '../userscript', '../../userscript', '@hv-pony-solver/userscript'],
  },
  {
    name: 'userscript must not import model worker',
    fromDir: 'apps/userscript/src',
    forbiddenImports: ['apps/model-worker', '../model-worker', '../../model-worker', '@hv-pony-solver/model-worker'],
  },
]

if (isDirectRun()) {
  try {
    const repoRoot = parseArgs(process.argv.slice(2))
    await checkArchitectureBoundaries(repoRoot)
    process.stdout.write('Architecture boundary check passed\n')
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
    return defaultRepoRoot
  }
  const repoRoot = args[repoRootIndex + 1]
  if (!repoRoot) {
    throw new Error('--repo-root requires a path')
  }
  return resolve(repoRoot)
}

async function checkArchitectureBoundaries(repoRoot = defaultRepoRoot) {
  const violations = []
  for (const rule of BOUNDARY_RULES) {
    const absoluteDir = resolve(repoRoot, rule.fromDir)
    if (!existsSync(absoluteDir)) {
      continue
    }
    const files = await collectSourceFiles(absoluteDir)
    for (const file of files) {
      const imports = extractImportSpecifiers(await readFile(file, 'utf8'))
      for (const importSpec of imports) {
        if (importSpec.typeOnly) {
          continue
        }
        if (rule.forbiddenImports.some((forbiddenImport) => matchesForbiddenImport(importSpec.specifier, forbiddenImport))) {
          violations.push(`${rule.name}: ${relative(repoRoot, file)} imports ${importSpec.specifier}`)
        }
      }
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

function extractImportSpecifiers(source) {
  const sourceFile = ts.createSourceFile('architecture-boundary-source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const specifiers = []

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push({ specifier: node.moduleSpecifier.text, typeOnly: isTypeOnlyImportDeclaration(node) })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push({ specifier: node.moduleSpecifier.text, typeOnly: isTypeOnlyExportDeclaration(node) })
    } else if (isStaticDynamicImport(node)) {
      specifiers.push({ specifier: node.arguments[0].text, typeOnly: false })
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function isTypeOnlyImportDeclaration(node) {
  if (!node.importClause) {
    return false
  }
  if (node.importClause.isTypeOnly) {
    return true
  }
  if (node.importClause.name) {
    return false
  }
  return isTypeOnlyNamedBindings(node.importClause.namedBindings)
}

function isTypeOnlyExportDeclaration(node) {
  if (node.isTypeOnly) {
    return true
  }
  if (!node.exportClause || !ts.isNamedExports(node.exportClause)) {
    return false
  }
  return node.exportClause.elements.length > 0 && node.exportClause.elements.every((element) => element.isTypeOnly)
}

function isTypeOnlyNamedBindings(namedBindings) {
  if (!namedBindings || !ts.isNamedImports(namedBindings)) {
    return false
  }
  return namedBindings.elements.length > 0 && namedBindings.elements.every((element) => element.isTypeOnly)
}

function isStaticDynamicImport(node) {
  return (
    ts.isCallExpression(node)
    && node.expression.kind === ts.SyntaxKind.ImportKeyword
    && node.arguments.length > 0
    && ts.isStringLiteral(node.arguments[0])
  )
}

function matchesForbiddenImport(specifier, forbiddenImport) {
  const normalizedSpecifier = normalizeModuleSpecifier(specifier)
  const normalizedForbidden = normalizeModuleSpecifier(forbiddenImport)
  if (normalizedSpecifier === normalizedForbidden) {
    return true
  }
  if (isBoundedSegmentMatcher(normalizedForbidden)) {
    return containsBoundedSegments(normalizedSpecifier, normalizedForbidden)
  }
  return normalizedSpecifier.startsWith(`${normalizedForbidden}/`)
}

function isBoundedSegmentMatcher(pattern) {
  return pattern.startsWith('/') && pattern.endsWith('/')
}

function containsBoundedSegments(specifier, pattern) {
  const specifierSegments = splitPathSegments(specifier)
  const patternSegments = splitPathSegments(pattern)
  for (let index = 0; index <= specifierSegments.length - patternSegments.length; index += 1) {
    const matchesSegments = patternSegments.every((segment, segmentIndex) => specifierSegments[index + segmentIndex] === segment)
    const hasFollowingSegment = index + patternSegments.length < specifierSegments.length
    if (matchesSegments && hasFollowingSegment) {
      return true
    }
  }
  return false
}

function splitPathSegments(specifier) {
  return normalizeModuleSpecifier(specifier).split('/').filter(Boolean)
}

function normalizeModuleSpecifier(specifier) {
  return specifier.replaceAll('\\', '/').replace(/\/+/g, '/')
}

export { BOUNDARY_RULES, checkArchitectureBoundaries, extractImportSpecifiers, matchesForbiddenImport }
