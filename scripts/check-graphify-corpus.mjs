import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDir, '..')

const REQUIRED_IGNORE_ENTRIES = [
  '.gitnexus/',
  'graphify-out/',
  '.codegraph/',
  '.code-review-graph',
  'docs/superpowers/',
  '.claude/',
  'node_modules/',
  '**/node_modules/',
  '**/dist/',
  '**/coverage/',
  '.pnpm-store/',
  'apps/userscript/.tmp/',
]

const FORBIDDEN_GRAPH_MARKERS = [
  '.gitnexus/',
  'fileHashes',
  'GitNexus Parse Cache',
  'GitNexus Index Metadata',
]

if (isDirectRun()) {
  try {
    const { repoRoot, report } = parseArgs(process.argv.slice(2))
    await checkGraphifyCorpus(repoRoot, { report })
    process.stdout.write('Graphify corpus check passed\n')
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

function isDirectRun() {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
}

function parseArgs(args) {
  let repoRoot = defaultRepoRoot
  let report = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--repo-root') {
      const value = args[index + 1]
      if (!value) {
        throw new Error('--repo-root requires a path')
      }
      repoRoot = resolve(value)
      index += 1
      continue
    }
    if (arg === '--report') {
      report = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return { repoRoot, report }
}

async function checkGraphifyCorpus(repoRoot = defaultRepoRoot, options = {}) {
  const graphifyIgnorePath = resolve(repoRoot, '.graphifyignore')
  const graphifyIgnore = await readFile(graphifyIgnorePath, 'utf8')
  const ignoreEntries = new Set(
    graphifyIgnore
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  )

  for (const requiredEntry of REQUIRED_IGNORE_ENTRIES) {
    if (!ignoreEntries.has(requiredEntry)) {
      throw new Error(`.graphifyignore is missing required entry: ${requiredEntry}`)
    }
  }

  if (options.report) {
    await checkGraphReport(resolve(repoRoot, 'graphify-out', 'GRAPH_REPORT.md'))
    await checkGraphJson(resolve(repoRoot, 'graphify-out', 'graph.json'))
  }
}

async function checkGraphReport(reportPath) {
  if (!existsSync(reportPath)) {
    throw new Error(`${reportPath} does not exist; run /graphify . before report validation`)
  }
  const report = await readFile(reportPath, 'utf8')
  for (const marker of FORBIDDEN_GRAPH_MARKERS) {
    if (report.includes(marker)) {
      throw new Error(`Graphify report contains generated-artifact marker: ${marker}`)
    }
  }
}

async function checkGraphJson(graphPath) {
  if (!existsSync(graphPath)) {
    throw new Error(`${graphPath} does not exist; run /graphify . before report validation`)
  }
  const graph = JSON.parse(await readFile(graphPath, 'utf8'))
  for (const node of graph.nodes ?? []) {
    const sourceFile = String(node.source_file ?? node.sourceFile ?? '')
    const label = String(node.label ?? '')
    const id = String(node.id ?? '')
    if (sourceFile.startsWith('.gitnexus/') || id === 'fileHashes' || label === 'fileHashes') {
      throw new Error(`Graphify graph contains generated-artifact node: ${id || label || sourceFile}`)
    }
  }
}

export { checkGraphifyCorpus, FORBIDDEN_GRAPH_MARKERS, REQUIRED_IGNORE_ENTRIES }
