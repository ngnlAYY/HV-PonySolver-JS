import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parseRepoRootArgs } from '../lib/cli.mjs'
import { isDirectRun } from '../lib/direct-run.mjs'

const defaultRepoRoot = resolve(import.meta.dirname, '../..')
const validators = ['verify-agent-note-tree.ts', 'verify-agent-note-format.ts', 'verify-archived-agent-notes.ts']

export function archiveBaseRef(environment, event) {
  if (environment.AGENT_NOTE_ARCHIVE_BASE_REF) return environment.AGENT_NOTE_ARCHIVE_BASE_REF
  if (environment.GITHUB_ACTIONS !== 'true') return 'HEAD'
  if (environment.GITHUB_EVENT_NAME === 'pull_request') {
    const sha = event?.pull_request?.base?.sha
    if (typeof sha === 'string' && /^[a-f\d]{40}$/u.test(sha)) return sha
    throw new Error('Notes archive check requires the pull request base SHA')
  }
  if (environment.GITHUB_EVENT_NAME === 'push') {
    const sha = event?.before
    if (typeof sha === 'string' && /^[a-f\d]{40}$/u.test(sha) && !/^0+$/u.test(sha)) return sha
    throw new Error('Notes archive check requires the pre-push SHA')
  }
  // Manual validation has no before/after pair; seals still verify disk content.
  if (environment.GITHUB_EVENT_NAME === 'workflow_dispatch') return 'HEAD'
  throw new Error('Notes archive check requires an explicit baseline for this CI event')
}

export async function verifyNotes(repoRoot = defaultRepoRoot) {
  const noteRoot = resolve(repoRoot, 'docs/decisions')
  if (!(await stat(noteRoot)).isDirectory()) throw new Error('docs/decisions must be a directory')
  const event =
    process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_EVENT_PATH
      ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
      : null
  const baseline = archiveBaseRef(process.env, event)
  // An unavailable baseline must not turn a shallow checkout into an empty archive.
  execFileSync('git', ['rev-parse', '--verify', `${baseline}^{commit}`], { cwd: repoRoot, stdio: 'pipe' })
  for (const validator of validators) {
    execFileSync(process.execPath, [resolve(import.meta.dirname, 'notes', validator)], {
      cwd: repoRoot,
      env: { ...process.env, AGENT_NOTE_ROOT: noteRoot, AGENT_NOTE_ARCHIVE_BASE_REF: baseline },
      stdio: 'inherit',
    })
  }
}

if (isDirectRun(import.meta.url)) {
  try {
    const { repoRoot } = parseRepoRootArgs(process.argv.slice(2), defaultRepoRoot)
    await verifyNotes(repoRoot)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
