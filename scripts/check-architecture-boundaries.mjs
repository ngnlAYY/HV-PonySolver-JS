import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parseRepoRootArgs } from './lib/cli.mjs'
import { isDirectRun } from './lib/direct-run.mjs'
import { collectSourceFiles } from './lib/source-files.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDir, '..')

const BOUNDARY_RULES = [
  {
    name: 'inference layer must not import status panel',
    fromDir: 'apps/userscript/src/inference',
    forbiddenImports: ['../status-panel', '/status-panel/', 'src/status-panel'],
  },
  {
    name: 'browser core inference must not import status panel at runtime',
    fromDir: 'packages/browser-core/src/inference',
    forbiddenImports: ['../status-panel', '/status-panel/', 'src/status-panel'],
  },
  {
    name: 'browser core status panel must not import inference',
    fromDir: 'packages/browser-core/src/status-panel',
    forbiddenImports: ['../inference', '/inference/', 'src/inference'],
  },
  {
    name: 'status panel must not import inference',
    fromDir: 'apps/userscript/src/status-panel',
    forbiddenImports: ['../inference', '/inference/', 'src/inference'],
  },
  {
    name: 'model worker must not import userscript',
    fromDir: 'apps/model-worker/src',
    forbiddenImports: [
      'apps/userscript',
      '/userscript/',
      '@hv-pony-solver/userscript',
      'apps/extension',
      '/extension/',
      '@hv-pony-solver/extension',
      '@hv-pony-solver/browser-core',
    ],
  },
  {
    name: 'userscript must not import model worker',
    fromDir: 'apps/userscript/src',
    forbiddenImports: [
      'apps/model-worker',
      '/model-worker/',
      '@hv-pony-solver/model-worker',
      'apps/extension',
      '/extension/',
      '@hv-pony-solver/extension',
    ],
  },
  {
    name: 'extension must not import private application code',
    fromDir: 'apps/extension/src',
    forbiddenImports: [
      'apps/userscript',
      '/userscript/',
      '@hv-pony-solver/userscript',
      'apps/model-worker',
      '/model-worker/',
      '@hv-pony-solver/model-worker',
    ],
  },
  {
    name: 'userscript must consume browser core through its package root',
    fromDir: 'apps/userscript',
    includeTypeOnly: true,
    forbiddenImports: ['@hv-pony-solver/browser-core/src', '/packages/browser-core/src/'],
  },
  {
    name: 'extension must consume browser core through its package root',
    fromDir: 'apps/extension',
    includeTypeOnly: true,
    forbiddenImports: ['@hv-pony-solver/browser-core/src', '/packages/browser-core/src/'],
  },
  {
    name: 'browser core must not import applications',
    fromDir: 'packages/browser-core/src',
    forbiddenImports: [
      '/apps/',
      '@hv-pony-solver/userscript',
      '@hv-pony-solver/extension',
      '@hv-pony-solver/model-worker',
    ],
  },
  {
    name: 'shared package must not import apps',
    fromDir: 'packages/shared/src',
    forbiddenImports: [
      '/apps/',
      '@hv-pony-solver/userscript',
      '@hv-pony-solver/extension',
      '@hv-pony-solver/model-worker',
      '@hv-pony-solver/browser-core',
    ],
  },
  {
    name: 'inference layer must not import userscript storage bridge',
    fromDir: 'apps/userscript/src/inference',
    forbiddenImports: ['/userscript/gm-bridge/', 'src/userscript/gm-bridge'],
  },
]

if (isDirectRun(import.meta.url)) {
  try {
    const { repoRoot, explicitRepoRoot } = parseRepoRootArgs(process.argv.slice(2), defaultRepoRoot)
    await checkArchitectureBoundaries(repoRoot, { requireSourceDirs: explicitRepoRoot })
    process.stdout.write('Architecture boundary check passed\n')
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

async function checkArchitectureBoundaries(repoRoot = defaultRepoRoot, { requireSourceDirs = false } = {}) {
  const violations = []
  const missingSourceDirs = []
  for (const rule of BOUNDARY_RULES) {
    const absoluteDir = resolve(repoRoot, rule.fromDir)
    if (!existsSync(absoluteDir)) {
      missingSourceDirs.push(rule.fromDir)
      continue
    }
    const files = await collectSourceFiles(absoluteDir)
    for (const file of files) {
      const imports = extractImportSpecifiers(await readFile(file, 'utf8'))
      for (const importSpec of imports) {
        if (importSpec.typeOnly && !rule.includeTypeOnly) {
          continue
        }
        if (
          rule.forbiddenImports.some((forbiddenImport) => matchesForbiddenImport(importSpec.specifier, forbiddenImport))
        ) {
          violations.push(`${rule.name}: ${relative(repoRoot, file)} imports ${importSpec.specifier}`)
        }
      }
    }
  }

  if (requireSourceDirs && missingSourceDirs.length > 0) {
    throw new Error(`architecture boundary source directories are missing: ${missingSourceDirs.join(', ')}`)
  }

  if (violations.length > 0) {
    throw new Error(violations.join('\n'))
  }
}

function extractImportSpecifiers(source) {
  const sourceFile = ts.createSourceFile(
    'architecture-boundary-source.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
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
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments.length > 0 &&
    ts.isStringLiteral(node.arguments[0])
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
    const matchesSegments = patternSegments.every(
      (segment, segmentIndex) => specifierSegments[index + segmentIndex] === segment,
    )
    const previousSegment = specifierSegments[index - 1]
    const startsAtBoundary = index === 0 || previousSegment === '.' || previousSegment === '..'
    if (matchesSegments && startsAtBoundary) {
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
