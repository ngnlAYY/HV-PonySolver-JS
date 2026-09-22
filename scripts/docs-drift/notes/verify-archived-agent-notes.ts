// Adapted from the write-notes-like-deepseek skill; project entry: ../verify-notes.mjs.
/**
 * Verify frozen archived Agent Notes: exact head layout, manifest.json seals,
 * append-only extension vs a git baseline (skipped gracefully without git).
 * Usage:
 *   npx tsx scripts/verify-archived-agent-notes.ts          # verify only
 *   npx tsx scripts/verify-archived-agent-notes.ts --write  # verify, then seal unsealed files
 * Env: AGENT_NOTE_ARCHIVE_BASE_REF (default HEAD) — git ref the manifest is compared against.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { agentNoteRoot } from './agent-note-tree.ts'

const isWrite = process.argv.includes('--write')
const errors: string[] = []
const warnings: string[] = []
const fail = (msg: string) => {
  errors.push(msg)
}

// --- collect archived files without following symbolic links
const archivedDir = join(agentNoteRoot, 'archived')
const files: string[] = []
function scan(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      fail(`${relative(agentNoteRoot, full)} — archived paths must not be symbolic links`)
    } else if (entry.isDirectory()) scan(full)
    else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relative(archivedDir, full).split('\\').join('/'))
    } else if (entry.name.endsWith('.md')) {
      fail(`${relative(agentNoteRoot, full)} — archived notes must be regular files`)
    }
  }
}
const archiveStats = lstatSync(archivedDir, { throwIfNoEntry: false })
if (archiveStats?.isSymbolicLink()) {
  fail('archived — archive root must not be a symbolic link')
} else if (archiveStats && !archiveStats.isDirectory()) {
  fail('archived — archive root must be a directory')
} else if (archiveStats) {
  scan(archivedDir)
}

function isArchiveNotePath(key: string): boolean {
  const segments = key.split('/')
  return (
    segments.length >= 2 &&
    segments[0] === 'archived' &&
    key.endsWith('.md') &&
    !key.includes('\\') &&
    !key.includes('\0') &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  )
}

// A seal is checked independently from discovery: an existing directory or a
// linked file must never stand in for the ordinary Markdown file it sealed.
function readArchivedNote(key: string): Buffer | null {
  if (!isArchiveNotePath(key)) {
    fail(`${key} — invalid sealed note path`)
    return null
  }
  const segments = key.split('/')
  let current = agentNoteRoot
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment)
    const stats = lstatSync(current, { throwIfNoEntry: false })
    if (!stats) {
      fail(`${key} — sealed entry has no file on disk`)
      return null
    }
    if (stats.isSymbolicLink()) {
      fail(`${key} — archived paths must not be symbolic links`)
      return null
    }
    if (index === segments.length - 1 ? !stats.isFile() : !stats.isDirectory()) {
      fail(`${key} — archived notes must be regular files beneath ordinary directories`)
      return null
    }
  }
  return readFileSync(current)
}

// --- head layout: L1 title / L2 blank / L3 Status / L4 Archived / L5 blank
const TITLE_RE = /^# Agent Note[:：] ?\S/
const ARCHIVED_RE = /^Archived: \d{4}-\d{2}-\d{2}$/
for (const rel of files) {
  const content = readArchivedNote(`archived/${rel}`)
  if (content === null) continue
  const lines = content
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  if (!TITLE_RE.test(lines[0] ?? '')) fail(`${rel} — line 1 must be \`# Agent Note: <title>\``)
  if (lines[1] !== '') fail(`${rel} — line 2 must be blank`)
  if (lines[2] !== 'Status: implemented') fail(`${rel} — line 3 must be \`Status: implemented\``)
  if (!ARCHIVED_RE.test(lines[3] ?? ''))
    fail(`${rel} — line 4 must be \`Archived: YYYY-MM-DD\` immediately below Status`)
  if (lines[4] !== '') fail(`${rel} — line 5 must be blank after Archived`)
}

// --- manifest seals
const manifestPath = join(archivedDir, 'manifest.json')
interface Manifest {
  version: 1
  files: Record<string, string>
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseManifest(raw: string, label: string): Manifest | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    fail(`${label} is not valid JSON`)
    return null
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isRecord(value.files) ||
    Object.keys(value).some((key) => key !== 'version' && key !== 'files')
  ) {
    fail(`${label} must contain version: 1 and a files object`)
    return null
  }
  const entries: Array<[string, string]> = []
  for (const [key, seal] of Object.entries(value.files)) {
    if (!isArchiveNotePath(key)) {
      fail(`${label} contains invalid sealed note path: ${key}`)
      return null
    }
    if (typeof seal !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(seal)) {
      fail(`${label} contains invalid SHA-256 seal for ${key}`)
      return null
    }
    entries.push([key, seal])
  }
  return { version: 1, files: Object.fromEntries(entries) }
}

let manifest: Manifest = { version: 1, files: {} }
if (archiveStats?.isDirectory()) {
  const manifestStats = lstatSync(manifestPath, { throwIfNoEntry: false })
  if (manifestStats?.isSymbolicLink()) {
    fail('archived/manifest.json must not be a symbolic link')
  } else if (manifestStats && !manifestStats.isFile()) {
    fail('archived/manifest.json must be a regular file')
  } else if (manifestStats) {
    manifest = parseManifest(readFileSync(manifestPath, 'utf8'), 'archived/manifest.json') ?? manifest
  } else if (files.length > 0 && !isWrite) {
    fail('archived/manifest.json missing — run with --write to seal existing archived notes')
  }
}

const sealOf = (content: Buffer) => `sha256:${createHash('sha256').update(content).digest('hex')}`

for (const rel of files) {
  const key = `archived/${rel}`
  const entry = manifest.files[key]
  if (!entry) {
    if (isWrite) {
      const content = readArchivedNote(key)
      if (content !== null) manifest.files[key] = sealOf(content)
    } else {
      fail(`${key} — missing seal in manifest.json (run with --write)`)
    }
  }
}
for (const [key, seal] of Object.entries(manifest.files)) {
  const content = readArchivedNote(key)
  if (content !== null && seal !== sealOf(content)) {
    fail(`${key} — seal mismatch: archived note was modified after sealing (frozen notes must never change)`)
  }
}

// --- append-only vs git baseline (skipped without git)
const repoRoot = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: agentNoteRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
})()
if (repoRoot) {
  const baseRef = process.env.AGENT_NOTE_ARCHIVE_BASE_REF || 'HEAD'
  const manifestRel = relative(repoRoot, manifestPath).split('\\').join('/')
  let baselineRaw: string | null = null
  try {
    baselineRaw = execFileSync('git', ['show', `${baseRef}:${manifestRel}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    // manifest absent at baseline — nothing to compare
  }
  if (baselineRaw !== null) {
    const baseline = parseManifest(baselineRaw, `archived/manifest.json at ${baseRef}`)
    if (baseline) {
      for (const [key, seal] of Object.entries(baseline.files)) {
        if (manifest.files[key] !== seal) {
          fail(`${key} — seal added/changed/removed relative to ${baseRef}; archived seals are append-only`)
        }
      }
    }
  }
} else {
  warnings.push('not a git repository — append-only check skipped (seal hashes still verified against disk)')
}

if (errors.length) {
  for (const e of errors) process.stderr.write(String(`archived: ${e}`) + '\n')
  process.exit(1)
}

if (isWrite && archiveStats?.isDirectory()) {
  const sorted = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(manifestPath, JSON.stringify({ version: 1, files: sorted }, null, 2) + '\n', 'utf8')
}

for (const w of warnings) process.stderr.write(String(`warning: ${w}`) + '\n')
process.stdout.write(
  String(`ok: ${files.length} archived note(s) verified, ${Object.keys(manifest.files).length} seal(s) in manifest`) +
    '\n',
)
