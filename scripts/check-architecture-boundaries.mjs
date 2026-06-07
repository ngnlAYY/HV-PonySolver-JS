import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
        if (rule.forbiddenImports.some((forbiddenImport) => importSpec.specifier.includes(forbiddenImport))) {
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
  const specifiers = []
  const staticImportPattern = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:([^'";]*?)\s+from(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*|)(['"])([^'"]+)\4/g
  const dynamicImportPattern = /import\s*\((?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*(['"])([^'"]+)\1/g
  let match = staticImportPattern.exec(source)
  while (match) {
    const clause = match[3] ?? ''
    const typeOnly = Boolean(match[2]) || isInlineTypeOnlyClause(clause)
    specifiers.push({ specifier: match[5], typeOnly })
    match = staticImportPattern.exec(source)
  }
  match = dynamicImportPattern.exec(source)
  while (match) {
    specifiers.push({ specifier: match[2], typeOnly: false })
    match = dynamicImportPattern.exec(source)
  }
  return specifiers
}

function isInlineTypeOnlyClause(clause) {
  const trimmedClause = stripComments(clause).trim()
  if (!trimmedClause.startsWith('{') || !trimmedClause.endsWith('}')) {
    return false
  }
  const namedSpecifiers = trimmedClause
    .slice(1, -1)
    .split(',')
    .map((specifier) => specifier.trim())
    .filter(Boolean)
  return namedSpecifiers.length > 0 && namedSpecifiers.every((specifier) => /^type\b/.test(specifier))
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n\r]*/g, ' ')
}

export { BOUNDARY_RULES, checkArchitectureBoundaries, extractImportSpecifiers }
