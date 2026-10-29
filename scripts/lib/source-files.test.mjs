import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectSourceFiles, createSourceFileCollector } from './source-files.mjs'

test('collects nested sources once per snapshot and refreshes on the next check', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'hv-source-files-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const nested = join(root, 'nested')
  await mkdir(nested)
  const first = join(nested, 'first.mts')
  const second = join(nested, 'second.cts')
  await writeFile(first, '')
  const collect = createSourceFileCollector()
  const parent = await collect(root)
  assert.deepEqual(parent, [first])
  assert.deepEqual(await collect(nested), [first])
  await writeFile(second, '')
  assert.equal(await collect(root), parent)
  assert.deepEqual((await collectSourceFiles(root)).sort(), [first, second])
})

test('rejects source file, directory, and root symlinks while excluding generated directories', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'hv-source-links-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const external = join(root, 'external')
  await mkdir(source)
  await mkdir(external)
  const file = join(external, 'payload.ts')
  await writeFile(file, 'Function("payload")')
  await symlink(external, join(source, 'node_modules'), 'dir')
  assert.deepEqual(await collectSourceFiles(source), [])
  for (const [name, target, type] of [
    ['payload.ts', file, 'file'],
    ['nested', external, 'dir'],
  ]) {
    const link = join(source, name)
    await symlink(target, link, type)
    await assert.rejects(collectSourceFiles(source), /Source tree contains a symbolic link/u)
    await rm(link)
  }
  const linkedRoot = join(root, 'linked-root')
  await symlink(source, linkedRoot, 'dir')
  await assert.rejects(collectSourceFiles(linkedRoot), /Source root must be a directory without a symbolic link/u)
})
