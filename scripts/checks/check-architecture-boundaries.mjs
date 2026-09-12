import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parseRepoRootArgs } from '../lib/cli.mjs'
import { isDirectRun } from '../lib/direct-run.mjs'
import { createSourceFileCollector } from '../lib/source-files.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDir, '../..')

const BOUNDARY_RULES = [
  {
    name: 'inference layer must not import status panel',
    fromDir: 'apps/userscript/src/inference',
    forbiddenImports: ['../status-panel', '/status-panel/', 'src/status-panel'],
    forbiddenSourcePaths: ['apps/userscript/src/status-panel'],
  },
  {
    name: 'browser core inference must not import status panel at runtime',
    fromDir: 'packages/browser-core/src/inference',
    forbiddenImports: ['../status-panel', '/status-panel/', 'src/status-panel'],
    forbiddenSourcePaths: ['packages/browser-core/src/status-panel'],
  },
  {
    name: 'browser core status panel must not import inference',
    fromDir: 'packages/browser-core/src/status-panel',
    forbiddenImports: ['../inference', '/inference/', 'src/inference'],
    forbiddenSourcePaths: ['packages/browser-core/src/inference'],
  },
  {
    name: 'status panel must not import inference',
    fromDir: 'apps/userscript/src/status-panel',
    forbiddenImports: ['../inference', '/inference/', 'src/inference'],
    forbiddenSourcePaths: ['apps/userscript/src/inference'],
  },
  {
    name: 'model worker must not import browser applications or browser core',
    fromDir: 'apps/model-worker/src',
    includeTypeOnly: true,
    forbiddenSourcePaths: ['apps/userscript', 'apps/extension', 'packages/browser-core'],
    forbiddenImports: [
      'apps/userscript',
      '/userscript/',
      '@hv-pony-solver/userscript',
      'apps/extension',
      '/extension/',
      '@hv-pony-solver/extension',
      '@hv-pony-solver/browser-core',
      '/packages/browser-core/',
    ],
  },
  {
    name: 'userscript must not import other applications',
    fromDir: 'apps/userscript/src',
    includeTypeOnly: true,
    forbiddenSourcePaths: ['apps/model-worker', 'apps/extension'],
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
    includeTypeOnly: true,
    forbiddenSourcePaths: ['apps/userscript', 'apps/model-worker'],
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
    forbiddenSourcePaths: ['packages/browser-core/src'],
    forbiddenImports: ['@hv-pony-solver/browser-core/src', '/packages/browser-core/src/'],
  },
  {
    name: 'extension must consume browser core through its package root',
    fromDir: 'apps/extension',
    includeTypeOnly: true,
    forbiddenSourcePaths: ['packages/browser-core/src'],
    forbiddenImports: ['@hv-pony-solver/browser-core/src', '/packages/browser-core/src/'],
  },
  {
    name: 'browser core must not import applications',
    fromDir: 'packages/browser-core/src',
    includeTypeOnly: true,
    forbiddenSourcePaths: ['apps'],
    forbiddenImports: [
      '/apps/',
      '@hv-pony-solver/userscript',
      '@hv-pony-solver/extension',
      '@hv-pony-solver/model-worker',
    ],
  },
  {
    name: 'shared package must not import apps or browser core',
    fromDir: 'packages/shared/src',
    includeTypeOnly: true,
    forbiddenSourcePaths: ['apps', 'packages/browser-core'],
    forbiddenImports: [
      '/apps/',
      '@hv-pony-solver/userscript',
      '@hv-pony-solver/extension',
      '@hv-pony-solver/model-worker',
      '@hv-pony-solver/browser-core',
      '/browser-core/',
      '/packages/browser-core/',
    ],
  },
  {
    name: 'inference layer must not import userscript storage bridge',
    fromDir: 'apps/userscript/src/inference',
    forbiddenImports: ['/userscript/gm-bridge/', 'src/userscript/gm-bridge'],
    forbiddenSourcePaths: ['apps/userscript/src/userscript/gm-bridge'],
  },
]

if (isDirectRun(import.meta.url)) {
  try {
    const { repoRoot } = parseRepoRootArgs(process.argv.slice(2), defaultRepoRoot)
    await checkArchitectureBoundaries(repoRoot, { requireSourceDirs: true })
    process.stdout.write('Architecture boundary check passed\n')
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

async function checkArchitectureBoundaries(repoRoot = defaultRepoRoot, { requireSourceDirs = false } = {}) {
  const violations = []
  const missingSourceDirs = []
  const collectSourceFiles = createSourceFileCollector()
  const importsByFile = new Map()
  for (const rule of BOUNDARY_RULES) {
    const absoluteDir = resolve(repoRoot, rule.fromDir)
    if (!existsSync(absoluteDir)) {
      missingSourceDirs.push(rule.fromDir)
      continue
    }
    const files = await collectSourceFiles(absoluteDir)
    for (const file of files) {
      if (!importsByFile.has(file)) importsByFile.set(file, extractImportSpecifiers(await readFile(file, 'utf8')))
      const imports = importsByFile.get(file)
      for (const importSpec of imports) {
        if (importSpec.typeOnly && !rule.includeTypeOnly) {
          continue
        }
        const specifier = importSpec.specifier.replaceAll('\\', '/')
        const sourcePath = specifier.startsWith('.')
          ? relative(repoRoot, resolve(dirname(file), specifier)).replace(/\.[cm]?[jt]sx?$/u, '')
          : null
        if (
          rule.forbiddenImports.some((forbiddenImport) => matchesForbiddenImport(specifier, forbiddenImport)) ||
          (sourcePath !== null &&
            rule.forbiddenSourcePaths.some((forbiddenPath) => matchesForbiddenImport(sourcePath, forbiddenPath)))
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
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push({ specifier: node.argument.literal.text, typeOnly: true })
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
  // 目录别名中的 ./ 与 ../ 不应绕过边界；保留路径段匹配以免误伤相邻目录名。
  return posix.normalize(specifier.replaceAll('\\', '/').replace(/\/+/g, '/'))
}

export { BOUNDARY_RULES, checkArchitectureBoundaries, extractImportSpecifiers, matchesForbiddenImport }
