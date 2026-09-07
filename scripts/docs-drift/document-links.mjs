import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseRepoRootArgs } from '../lib/cli.mjs'
import { isDirectRun } from '../lib/direct-run.mjs'

const IGNORED_DIRECTORY_NAMES = new Set([
  '.claude',
  '.codegraph',
  '.codex',
  '.git',
  '.omx',
  '.wrangler',
  'config',
  'coverage',
  'dist',
  'model',
  'node_modules',
  'other',
  '.tmp',
])
const GENERATED_FILE_NAMES = new Set(['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'])

function isWithinRepository(repoRoot, filePath) {
  const pathFromRoot = relative(repoRoot, filePath)
  return (
    pathFromRoot === '' ||
    (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !pathFromRoot.startsWith(sep))
  )
}

function relativeDisplay(repoRoot, filePath) {
  return relative(repoRoot, filePath).split(sep).join('/') || '.'
}

function ignoredOrGeneratedReason(repoRoot, filePath) {
  const pathParts = relativeDisplay(repoRoot, filePath).split('/')
  if (pathParts.some((part) => IGNORED_DIRECTORY_NAMES.has(part) && part !== 'model') || pathParts[0] === 'model') {
    return 'targets an ignored or generated path'
  }
  const basename = pathParts.at(-1) ?? ''
  if (GENERATED_FILE_NAMES.has(basename) || /(?:\.generated|\.gen)(?:\.[^.]+)?$/u.test(basename)) {
    return 'targets a generated file'
  }
  return null
}

async function collectDocumentationFiles(repoRoot) {
  const files = []
  const errors = []
  async function visit(directory, relativeDirectory = '') {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      errors.push(
        `${relativeDisplay(repoRoot, directory)}: unable to scan documentation directory (${error instanceof Error ? error.message : String(error)})`,
      )
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (
        entry.isDirectory() &&
        ((IGNORED_DIRECTORY_NAMES.has(entry.name) && entry.name !== 'model') ||
          (relativeDirectory === '' && entry.name === 'model'))
      ) {
        continue
      }
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path, relativePath)
        continue
      }
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.md') continue
      if (relativePath === 'README.md' || entry.name === 'AGENTS.md' || relativePath.startsWith('docs/')) {
        files.push(path)
      }
    }
  }
  await visit(repoRoot)
  return { errors, files: files.sort() }
}

function stripFencedCode(source) {
  const lines = source.split(/\r?\n/u)
  const visible = []
  let fence = null
  for (const line of lines) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1]
    if (marker) {
      const character = marker[0]
      if (fence === null) fence = { character, length: marker.length }
      else if (fence.character === character && marker.length >= fence.length) fence = null
      visible.push('')
      continue
    }
    visible.push(fence === null ? line : '')
  }
  return visible
}

function headingSlug(title) {
  return title
    .replace(/`/gu, '')
    .replace(/<[^>]*>/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .trim()
    .replace(/\s+/gu, '-')
}

function headingAnchors(lines) {
  const anchors = new Set()
  for (const line of lines) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u)
    if (!match?.[1]) continue
    const base = headingSlug(match[1])
    if (!base) continue
    let candidate = base
    let suffix = 0
    while (anchors.has(candidate)) {
      suffix += 1
      candidate = `${base}-${suffix}`
    }
    anchors.add(candidate)
  }
  return anchors
}

function isExternalDestination(destination) {
  return destination.startsWith('//') || /^[a-z][a-z\d+.-]*:/iu.test(destination)
}

function decodePart(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function destinationsInLine(line) {
  const destinations = []
  const pattern = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+[^)]*)?\)/gu
  for (const match of line.matchAll(pattern)) {
    const destination = match[1]
    destinations.push(
      destination?.startsWith('<') && destination.endsWith('>') ? destination.slice(1, -1) : destination,
    )
  }
  return destinations
}

function stripInlineCode(line) {
  return line.replace(/`+[\s\S]*?`+/gu, (codeSpan) => {
    const openingLength = codeSpan.match(/^`+/u)?.[0].length ?? 0
    const closingLength = codeSpan.match(/`+$/u)?.[0].length ?? 0
    return openingLength === closingLength ? '' : codeSpan
  })
}

async function checkDocument(repoRoot, filePath, source) {
  const errors = []
  const lines = stripFencedCode(source)
  const sourceLabel = relativeDisplay(repoRoot, filePath)
  const anchorsByFile = new Map([[filePath, headingAnchors(lines)]])
  const addError = (lineNumber, destination, reason) => {
    errors.push(`${sourceLabel}:${lineNumber}: link "${destination}" ${reason}`)
  }

  for (let index = 0; index < lines.length; index += 1) {
    for (const destination of destinationsInLine(stripInlineCode(lines[index]))) {
      if (!destination || isExternalDestination(destination)) continue
      const hashIndex = destination.indexOf('#')
      const queryIndex = destination.indexOf('?')
      const pathEnd =
        [hashIndex, queryIndex].filter((value) => value >= 0).sort((left, right) => left - right)[0] ??
        destination.length
      const rawPath = destination.slice(0, pathEnd)
      const rawFragment = hashIndex >= 0 ? destination.slice(hashIndex + 1).split('?')[0] : ''
      const decodedPath = decodePart(rawPath)
      const decodedFragment = decodePart(rawFragment)
      if (decodedPath === null || decodedFragment === null) {
        addError(index + 1, destination, 'contains invalid percent encoding')
        continue
      }
      if (decodedPath.startsWith('/')) {
        addError(index + 1, destination, 'escapes the repository')
        continue
      }
      const targetPath = decodedPath ? resolve(dirname(filePath), decodedPath) : filePath
      if (!isWithinRepository(repoRoot, targetPath)) {
        addError(index + 1, destination, 'escapes the repository')
        continue
      }
      const generatedReason = ignoredOrGeneratedReason(repoRoot, targetPath)
      if (generatedReason) {
        addError(index + 1, destination, generatedReason)
        continue
      }
      let canonicalTargetPath
      try {
        canonicalTargetPath = await realpath(targetPath)
      } catch {
        addError(index + 1, destination, 'does not exist')
        continue
      }
      if (!isWithinRepository(repoRoot, canonicalTargetPath)) {
        addError(index + 1, destination, 'escapes the repository')
        continue
      }
      const canonicalGeneratedReason = ignoredOrGeneratedReason(repoRoot, canonicalTargetPath)
      if (canonicalGeneratedReason) {
        addError(index + 1, destination, canonicalGeneratedReason)
        continue
      }
      const targetStats = await stat(canonicalTargetPath)
      if (!decodedFragment || targetStats.isDirectory()) continue
      if (extname(canonicalTargetPath).toLowerCase() !== '.md') {
        continue
      }
      let targetAnchors = anchorsByFile.get(canonicalTargetPath)
      if (!targetAnchors) {
        try {
          targetAnchors = headingAnchors(stripFencedCode(await readFile(canonicalTargetPath, 'utf8')))
          anchorsByFile.set(canonicalTargetPath, targetAnchors)
        } catch {
          addError(index + 1, destination, 'target cannot be read')
          continue
        }
      }
      if (!targetAnchors.has(decodedFragment.toLocaleLowerCase())) {
        addError(index + 1, destination, 'references a missing anchor')
      }
    }
  }
  return errors
}

/** Scans repository maintenance Markdown and returns diagnostic link errors. */
async function checkDocumentationLinks(repoRoot) {
  const resolvedRoot = resolve(repoRoot)
  const errors = []
  let canonicalRoot
  try {
    canonicalRoot = await realpath(resolvedRoot)
  } catch (error) {
    return [
      `${relativeDisplay(resolvedRoot, resolvedRoot)}: unable to scan documentation directory (${error instanceof Error ? error.message : String(error)})`,
    ]
  }
  const collection = await collectDocumentationFiles(canonicalRoot)
  errors.push(...collection.errors)
  for (const filePath of collection.files) {
    try {
      errors.push(...(await checkDocument(canonicalRoot, filePath, await readFile(filePath, 'utf8'))))
    } catch (error) {
      errors.push(`${relativeDisplay(canonicalRoot, filePath)}: unable to read documentation (${String(error)})`)
    }
  }
  return errors
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDirectory, '../..')

if (isDirectRun(import.meta.url)) {
  try {
    const { repoRoot } = parseRepoRootArgs(process.argv.slice(2), defaultRepoRoot)
    const errors = await checkDocumentationLinks(repoRoot)
    if (errors.length > 0) {
      process.stderr.write(`${errors.join('\n')}\n`)
      process.exitCode = 1
    } else {
      process.stdout.write('Documentation link check passed\n')
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

export { checkDocumentationLinks }
