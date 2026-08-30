import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { resolveOrtBuildRoot } from './resolve-ort-build-root.mjs'

test('accepts a canonical dedicated ORT build directory', () => {
  assert.equal(resolveOrtBuildRoot('/tmp/hv-pony-ort-v1.27.0'), '/tmp/hv-pony-ort-v1.27.0')
})

test('rejects lexical traversal out of an apparently safe ORT directory', () => {
  assert.throws(() => resolveOrtBuildRoot('/tmp/hv-pony-ort-safe/../escape'), /unsafe ORT build root/)
})

test('rejects broad or unrelated directories', () => {
  for (const path of ['/', '/tmp', '/tmp/hv-pony-runtime']) {
    assert.throws(() => resolveOrtBuildRoot(path), /unsafe ORT build root/)
  }
})

test('rejects existing and dangling symbolic-link build roots', async (context) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hv-pony-ort-root-test-'))
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }))
  const target = join(temporaryRoot, 'hv-pony-ort-target')
  const existingLink = join(temporaryRoot, 'hv-pony-ort-existing-link')
  const danglingLink = join(temporaryRoot, 'hv-pony-ort-dangling-link')
  await mkdir(target)
  await symlink(target, existingLink, 'dir')
  await symlink(join(temporaryRoot, 'hv-pony-ort-missing-target'), danglingLink, 'dir')

  assert.throws(() => resolveOrtBuildRoot(existingLink), /symbolic link/)
  assert.throws(() => resolveOrtBuildRoot(danglingLink), /symbolic link/)
})
