import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { archiveBaseRef } from '../verify-notes.mjs'

const checker = resolve(import.meta.dirname, '../verify-notes.mjs')
const valid =
  '# Agent Note: Example\n\nStatus: implemented\n\n## Problem\n\nA problem.\n\n## Decision\n\nA choice.\n\n## Alternatives considered\n\nAnother choice.\n\n## Consequences\n\nA cost.\n'

async function fixture(callback) {
  const root = await mkdtemp(join(tmpdir(), 'hv-document-notes-'))
  try {
    const note = join(root, 'docs/decisions/implemented/process/2026-09-16-example.md')
    await mkdir(dirname(note), { recursive: true })
    await writeFile(note, valid)
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync(
      'git',
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'],
      { cwd: root },
    )
    await callback(root, note)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function run(root, extra = {}) {
  return spawnSync(process.execPath, [checker, '--repo-root', root], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'false', AGENT_NOTE_ARCHIVE_BASE_REF: 'HEAD', ...extra },
  })
}

test('notes gate accepts implemented records and rejects missing alternatives or proposal sections', async () => {
  await fixture(async (root, note) => {
    assert.equal(run(root).status, 0)
    await writeFile(note, valid.replace('## Alternatives considered', '## Other'))
    assert.notEqual(run(root).status, 0)
    await writeFile(note, `${valid}\n## Proposal\n\nNot implemented.\n`)
    assert.notEqual(run(root).status, 0)
  })
})

test('notes gate rejects lifecycle mismatch, invalid class and dangling note links', async () => {
  await fixture(async (root, note) => {
    await writeFile(note, valid.replace('Status: implemented', 'Status: proposed'))
    assert.notEqual(run(root).status, 0)
    await writeFile(note, `${valid}\n[missing](2026-09-16-missing.md)\n`)
    assert.notEqual(run(root).status, 0)
    await writeFile(note, valid)
    const bad = join(root, 'docs/decisions/implemented/misc/2026-09-16-example.md')
    await mkdir(dirname(bad), { recursive: true })
    await writeFile(bad, valid)
    assert.notEqual(run(root).status, 0)
  })
})

test('missing decision root or unavailable archive baseline fails closed', async () => {
  await fixture(async (root) => {
    assert.notEqual(run(root, { AGENT_NOTE_ARCHIVE_BASE_REF: 'nonexistent-ref' }).status, 0)
    await rm(join(root, 'docs/decisions'), { recursive: true })
    assert.notEqual(run(root).status, 0)
  })
})

test('archive seals reject edits even when the new seal is recomputed', async () => {
  await fixture(async (root) => {
    const key = 'archived/process/2026-09-16-example.md'
    const archive = join(root, 'docs/decisions', key)
    const manifest = join(root, 'docs/decisions/archived/manifest.json')
    await mkdir(dirname(archive), { recursive: true })
    const archived = valid.replace('Status: implemented\n', 'Status: implemented\nArchived: 2026-09-16\n')
    const seal = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`
    await writeFile(archive, archived)
    await writeFile(manifest, JSON.stringify({ version: 1, files: { [key]: seal(archived) } }))
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync(
      'git',
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'archive fixture'],
      { cwd: root },
    )
    assert.equal(run(root).status, 0)
    const changed = `${await readFile(archive, 'utf8')}\nChanged.\n`
    await writeFile(archive, changed)
    assert.notEqual(run(root).status, 0)
    await writeFile(manifest, JSON.stringify({ version: 1, files: { [key]: seal(changed) } }))
    assert.notEqual(run(root).status, 0)
    await rm(join(root, 'docs/decisions/archived'), { recursive: true })
    assert.notEqual(run(root).status, 0)
  })
})

test('CI archive baselines use the previous revision and reject missing push/PR context', () => {
  const before = 'a'.repeat(40)
  const base = 'b'.repeat(40)
  const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push' }
  assert.equal(archiveBaseRef(env, { before }), before)
  assert.equal(
    archiveBaseRef({ ...env, GITHUB_EVENT_NAME: 'pull_request' }, { pull_request: { base: { sha: base } } }),
    base,
  )
  assert.throws(() => archiveBaseRef(env, {}))
  assert.throws(() => archiveBaseRef(env, { before: '0'.repeat(40) }))
  assert.throws(() => archiveBaseRef({ ...env, GITHUB_EVENT_NAME: 'pull_request' }, {}))
  assert.equal(archiveBaseRef({ GITHUB_ACTIONS: 'false' }, null), 'HEAD')
})
