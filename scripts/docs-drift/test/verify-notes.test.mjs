import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { archiveBaseRef } from '../verify-notes.mjs'

const checker = resolve(import.meta.dirname, '../verify-notes.mjs')
const valid =
  '# Agent Note: Example\n\nStatus: implemented\n\n## Problem\n\nA problem.\n\n## Decision\n\nA choice.\n\n## Alternatives considered\n\nAnother choice.\n\n## Consequences\n\nA cost.\n'
const archiveKey = 'archived/process/2026-09-16-example.md'
const archived = valid.replace('Status: implemented\n', 'Status: implemented\nArchived: 2026-09-16\n')
const seal = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`

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

function runArchiveWriter(root, extra = {}) {
  return spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, '../notes/verify-archived-agent-notes.ts'), '--write'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        AGENT_NOTE_ROOT: join(root, 'docs/decisions'),
        AGENT_NOTE_ARCHIVE_BASE_REF: 'HEAD',
        ...extra,
      },
    },
  )
}

async function createSealedArchive(root) {
  const archive = join(root, 'docs/decisions', archiveKey)
  const manifest = join(root, 'docs/decisions/archived/manifest.json')
  await mkdir(dirname(archive), { recursive: true })
  await writeFile(archive, archived)
  await writeFile(manifest, JSON.stringify({ version: 1, files: { [archiveKey]: seal(archived) } }))
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync(
    'git',
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'archive fixture'],
    { cwd: root },
  )
  const baseline = run(root)
  assert.equal(baseline.status, 0, baseline.stderr)
  assert.match(baseline.stdout, /1 archived note\(s\) verified, 1 seal\(s\) in manifest/u)
  return { archive, manifest }
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

test('note sections inside tilde or longer backtick fences do not satisfy required prose', async () => {
  await fixture(async (root, note) => {
    const sectionStart = valid.indexOf('## Problem')
    for (const [opening, closing] of [
      ['~~~markdown', '~~~'],
      ['````markdown\n```', '````'],
    ]) {
      await writeFile(note, `${valid.slice(0, sectionStart)}${opening}\n${valid.slice(sectionStart)}${closing}\n`)
      const result = run(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /missing one of|first section must be/u)
    }
  })
})

test('note format ignores status, proposal headings and comments within matching fences', async () => {
  await fixture(async (root, note) => {
    for (const [opening, closing] of [
      ['~~~markdown', '~~~'],
      ['````markdown\n```', '````'],
      ['```markdown\n```not-a-closing-fence', '```'],
    ]) {
      await writeFile(note, `${valid}\n${opening}\nStatus: proposed\n## Proposal\n<!--\n${closing}\n`)
      const result = run(root)
      assert.equal(result.status, 0, result.stderr)
    }
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

test('notes gate hides Git diagnostics and baseline values when baseline verification fails', async () => {
  await fixture(async (root) => {
    const manifest = join(root, 'docs/decisions/archived/manifest.json')
    for (const extra of [
      { AGENT_NOTE_ARCHIVE_BASE_REF: 'public-invalid-baseline-sentinel' },
      { GIT_CONFIG_COUNT: 'public-invalid-git-config-sentinel' },
      { GIT_DIR: join(root, 'public-invalid-git-directory-sentinel') },
      { PATH: join(root, 'public-unavailable-git-sentinel') },
    ]) {
      const result = run(root, extra)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /Notes archive check requires an accessible baseline commit/u)
      assert.doesNotMatch(result.stdout + result.stderr, /public-(?:invalid|unavailable)|fatal:|GIT_CONFIG_COUNT/u)
      await assert.rejects(readFile(manifest), { code: 'ENOENT' })
    }
  })
})

test('malformed CI event input fails without echoing its contents', async () => {
  await fixture(async (root) => {
    const eventPath = join(root, 'event.json')
    await writeFile(eventPath, '{public-invalid-event-sentinel')
    const result = run(root, { GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: eventPath })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /readable JSON CI event/u)
    assert.doesNotMatch(result.stderr, /public-invalid-event-sentinel/u)
  })
})

test('archive seals reject edits even when the new seal is recomputed', async () => {
  await fixture(async (root) => {
    const { archive, manifest } = await createSealedArchive(root)
    const changed = `${await readFile(archive, 'utf8')}\nChanged.\n`
    await writeFile(archive, changed)
    assert.notEqual(run(root).status, 0)
    await writeFile(manifest, JSON.stringify({ version: 1, files: { [archiveKey]: seal(changed) } }))
    assert.notEqual(run(root).status, 0)
    await rm(join(root, 'docs/decisions/archived'), { recursive: true })
    assert.notEqual(run(root).status, 0)
  })
})

test('the direct archive writer rejects an unavailable or non-commit baseline without rewriting seals', async () => {
  await fixture(async (root) => {
    const { archive, manifest } = await createSealedArchive(root)
    const changed = `${archived}\nChanged after sealing.\n`
    await writeFile(archive, changed)
    const recomputed = JSON.stringify({ version: 1, files: { [archiveKey]: seal(changed) } })
    await writeFile(manifest, recomputed)
    for (const baseRef of ['nonexistent-ref', 'HEAD:docs/decisions/archived/manifest.json']) {
      const result = runArchiveWriter(root, { AGENT_NOTE_ARCHIVE_BASE_REF: baseRef })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /archive baseline must resolve to an accessible commit/u)
      assert.equal(await readFile(manifest, 'utf8'), recomputed)
    }
    const validBaseline = runArchiveWriter(root)
    assert.notEqual(validBaseline.status, 0)
    assert.match(validBaseline.stderr, /archived seals are append-only/u)
    assert.equal(await readFile(manifest, 'utf8'), recomputed)
  })
})

test('the direct archive writer fails closed on Git discovery errors without leaking diagnostics', async () => {
  await fixture(async (root) => {
    const { archive, manifest } = await createSealedArchive(root)
    const changed = `${archived}\nChanged after sealing.\n`
    await writeFile(archive, changed)
    const recomputed = JSON.stringify({ version: 1, files: { [archiveKey]: seal(changed) } })
    await writeFile(manifest, recomputed)
    const invalidConfig = { GIT_CONFIG_COUNT: 'public-invalid-git-config-sentinel' }
    for (const extra of [
      invalidConfig,
      { GIT_DIR: join(root, 'public-invalid-git-directory-sentinel') },
      { PATH: join(root, 'public-unavailable-git-sentinel') },
    ]) {
      const result = runArchiveWriter(root, extra)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /archive Git repository discovery failed/u)
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /public-(?:invalid|unavailable)-git|GIT_CONFIG_COUNT|append-only check skipped/u,
      )
      assert.equal(await readFile(manifest, 'utf8'), recomputed)
    }

    await rm(manifest)
    const unsealed = runArchiveWriter(root, invalidConfig)
    assert.equal(unsealed.status, 1)
    assert.match(unsealed.stderr, /archive Git repository discovery failed/u)
    await assert.rejects(readFile(manifest), { code: 'ENOENT' })
  })
})

test('a non-repository Git diagnostic does not bypass damaged repository metadata', async () => {
  await fixture(async (root) => {
    const { archive, manifest } = await createSealedArchive(root)
    const changed = `${archived}\nChanged after sealing.\n`
    await writeFile(archive, changed)
    const recomputed = JSON.stringify({ version: 1, files: { [archiveKey]: seal(changed) } })
    await writeFile(manifest, recomputed)
    await rename(join(root, '.git'), join(root, 'saved-git-metadata'))
    await mkdir(join(root, '.git'))

    const result = runArchiveWriter(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /archive Git repository discovery failed/u)
    assert.doesNotMatch(result.stderr, /append-only check skipped/u)
    assert.equal(await readFile(manifest, 'utf8'), recomputed)
  })
})

test('the direct archive writer seals and appends ordinary notes outside Git repositories', async () => {
  await fixture(async (root) => {
    await rm(join(root, '.git'), { recursive: true })
    const archive = join(root, 'docs/decisions', archiveKey)
    const manifest = join(root, 'docs/decisions/archived/manifest.json')
    await mkdir(dirname(archive), { recursive: true })
    await writeFile(archive, archived)
    const first = runArchiveWriter(root)
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stderr, /not a git repository — append-only check skipped/u)
    assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), {
      version: 1,
      files: { [archiveKey]: seal(archived) },
    })

    const extraKey = 'archived/process/2026-09-16-extra.md'
    await writeFile(join(root, 'docs/decisions', extraKey), archived)
    const appended = runArchiveWriter(root)
    assert.equal(appended.status, 0, appended.stderr)
    assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), {
      version: 1,
      files: { [archiveKey]: seal(archived), [extraKey]: seal(archived) },
    })
  })
})

test('filesystem-boundary discovery permits sealing only when Git metadata is absent', async () => {
  await fixture(async (root) => {
    const archive = join(root, 'docs/decisions', archiveKey)
    const manifest = join(root, 'docs/decisions/archived/manifest.json')
    await mkdir(dirname(archive), { recursive: true })
    await writeFile(archive, archived)
    const commandDirectory = join(root, 'public-git-fixture')
    await mkdir(commandDirectory)
    await writeFile(
      join(commandDirectory, 'git'),
      "#!/bin/sh\nprintf '%s\\n' 'fatal: not a git repository (or any parent up to mount point /public-fixture-mount)' 'Stopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).' >&2\nexit 128\n",
      { mode: 0o700 },
    )
    const metadataPresent = runArchiveWriter(root, { PATH: commandDirectory })
    assert.equal(metadataPresent.status, 1)
    await assert.rejects(readFile(manifest), { code: 'ENOENT' })

    await rm(join(root, '.git'), { recursive: true })
    const outside = runArchiveWriter(root, { PATH: commandDirectory })
    assert.equal(outside.status, 0, outside.stderr)
    assert.deepEqual(JSON.parse(await readFile(manifest, 'utf8')), {
      version: 1,
      files: { [archiveKey]: seal(archived) },
    })
  })
})

test('an optional empty archive passes and write mode only appends seals for ordinary notes', async () => {
  await fixture(async (root) => {
    assert.equal(run(root).status, 0)
    assert.equal(runArchiveWriter(root).status, 0)
    const archiveRoot = join(root, 'docs/decisions/archived')
    await mkdir(archiveRoot)
    assert.equal(run(root).status, 0)
    assert.equal(runArchiveWriter(root).status, 0)
    const archive = join(root, 'docs/decisions', archiveKey)
    await mkdir(dirname(archive))
    await writeFile(archive, archived)
    const written = runArchiveWriter(root)
    assert.equal(written.status, 0, written.stderr)
    assert.deepEqual(JSON.parse(await readFile(join(archiveRoot, 'manifest.json'), 'utf8')), {
      version: 1,
      files: { [archiveKey]: seal(archived) },
    })
    assert.equal(run(root).status, 0)
  })
})

for (const linkedPart of ['root', 'directory', 'note', 'manifest']) {
  test(`archive seals reject a symbolic link replacing the ${linkedPart}`, async () => {
    await fixture(async (root) => {
      const { archive, manifest } = await createSealedArchive(root)
      const originalManifest = await readFile(manifest, 'utf8')
      const linkPaths = {
        root: dirname(manifest),
        directory: dirname(archive),
        note: archive,
        manifest,
      }
      const target = join(root, `replacement-${linkedPart}`)
      const isDirectory = linkedPart === 'root' || linkedPart === 'directory'
      await rename(linkPaths[linkedPart], target)
      if (linkedPart === 'note') await writeFile(target, 'Changed content without the original note header.\n')
      await symlink(target, linkPaths[linkedPart], isDirectory ? 'dir' : 'file')

      const result = run(root)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /symbolic link/u)
      const written = runArchiveWriter(root)
      assert.notEqual(written.status, 0)
      assert.match(written.stderr, /symbolic link/u)
      assert.equal(await readFile(manifest, 'utf8'), originalManifest)
    })
  })
}

for (const linkedPart of ['docs', 'decisions']) {
  test(`notes gate and direct sealing reject a linked ${linkedPart} root outside the repository`, async () => {
    await fixture(async (root) => {
      const { archive, manifest } = await createSealedArchive(root)
      const external = await mkdtemp(join(tmpdir(), 'hv-notes-external-'))
      try {
        const source = join(root, linkedPart === 'docs' ? 'docs' : 'docs/decisions')
        const target = join(external, 'notes')
        await rename(source, target)
        await symlink(target, source, 'dir')
        const changed = `${archived}\nChanged after sealing.\n`
        await writeFile(archive, changed)
        const recomputed = JSON.stringify({ version: 1, files: { [archiveKey]: seal(changed) } })
        await writeFile(manifest, recomputed)

        for (const result of [run(root), runArchiveWriter(root)]) {
          assert.notEqual(result.status, 0)
          assert.match(result.stderr, /symbolic link/u)
          assert.doesNotMatch(result.stderr, /append-only check skipped/u)
        }
        assert.equal(await readFile(manifest, 'utf8'), recomputed)
      } finally {
        await rm(external, { recursive: true, force: true })
      }
    })
  })
}

test('archive seals reject a sealed path replaced by a directory', async () => {
  await fixture(async (root) => {
    const { archive } = await createSealedArchive(root)
    await rm(archive)
    await mkdir(archive)
    const result = run(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /regular files/u)
  })
})

test('archive manifests reject escaping, non-canonical and non-Markdown seal paths', async () => {
  await fixture(async (root) => {
    const { manifest } = await createSealedArchive(root)
    await writeFile(join(root, 'docs/decisions/outside.md'), archived)
    await writeFile(join(root, 'docs/decisions/archived/process/extra.txt'), archived)
    const paths = [
      'archived/../outside.md',
      '../outside.md',
      join(root, 'docs/decisions/outside.md'),
      'archived\\process\\2026-09-16-example.md',
      'archived//process/2026-09-16-example.md',
      'archived/./process/2026-09-16-example.md',
      'archived/process/extra.txt',
      'implemented/process/2026-09-16-example.md',
    ]
    for (const path of paths) {
      await writeFile(
        manifest,
        JSON.stringify({ version: 1, files: { [archiveKey]: seal(archived), [path]: seal(archived) } }),
      )
      const result = run(root)
      assert.notEqual(result.status, 0, path)
      assert.match(result.stderr, /invalid sealed note path/u)
    }
  })
})

test('archive manifests reject malformed schema and hashes without rewriting the manifest', async () => {
  await fixture(async (root) => {
    const { manifest } = await createSealedArchive(root)
    for (const malformed of [
      null,
      [],
      { version: 2, files: {} },
      { version: 1, files: [] },
      { version: 1, files: { [archiveKey]: 'sha256:invalid' } },
      { version: 1, files: { [archiveKey]: null } },
    ]) {
      const original = JSON.stringify(malformed)
      await writeFile(manifest, original)
      const result = run(root)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /must contain version: 1|invalid SHA-256 seal/u)
      assert.notEqual(runArchiveWriter(root).status, 0)
      assert.equal(await readFile(manifest, 'utf8'), original)
    }
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
