import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

import { assertSafeOrtRemovalPath, resolveOrtBuildRoot } from './resolve-ort-build-root.mjs'

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

test('protects the initial cwd and its ancestors through canonical paths', async (context) => {
  const parent = await mkdtemp(join(tmpdir(), 'ort-protected-cwd-'))
  context.after(() => rm(parent, { recursive: true, force: true }))
  const buildRoot = join(parent, 'hv-pony-ort-work')
  const cwd = join(buildRoot, 'model-output', 'project')
  const alias = join(parent, 'cwd-alias')
  await mkdir(cwd, { recursive: true })
  await symlink(cwd, alias, 'dir')

  for (const initialCwd of [buildRoot, cwd, alias]) {
    assert.throws(() => resolveOrtBuildRoot(buildRoot, { initialCwd }), /protected directory/)
  }
  assert.equal(resolveOrtBuildRoot(`${buildRoot}-sibling`, { initialCwd: cwd }), `${buildRoot}-sibling`)
})

test('rejects build roots inside the repository even when they have a dedicated name', () => {
  const nestedRoot = resolve(import.meta.dirname, 'hv-pony-ort-source-output')
  assert.throws(() => resolveOrtBuildRoot(nestedRoot), /protected directory/)
})

test('cleanup accepts only canonical descendants and refuses root, escapes, and symbolic links', async (context) => {
  const parent = await mkdtemp(join(tmpdir(), 'ort-removal-'))
  context.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'hv-pony-ort-work')
  const outside = join(parent, 'outside')
  await mkdir(root)
  await mkdir(outside)
  await symlink(outside, join(root, 'linked-output'), 'dir')

  assert.doesNotThrow(() => assertSafeOrtRemovalPath(join(root, 'model-output'), root))
  for (const target of [root, outside, join(root, 'linked-output'), join(root, 'linked-output', 'child')]) {
    assert.throws(() => assertSafeOrtRemovalPath(target, root), /unsafe ORT removal path/)
  }
})

test('cleanup rechecks protected paths if an ancestor changed after entry validation', async (context) => {
  const parent = await mkdtemp(join(tmpdir(), 'ort-removal-recheck-'))
  context.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'hv-pony-ort-work')
  const outside = join(parent, 'outside')
  const initialCwd = join(parent, 'initial-cwd')
  await mkdir(root)
  await mkdir(outside)
  await symlink(outside, initialCwd, 'dir')
  assert.equal(resolveOrtBuildRoot(root, { initialCwd }), root)
  await rm(initialCwd)
  await symlink(join(root, 'model-output'), initialCwd, 'dir')
  await mkdir(join(root, 'model-output'))

  assert.throws(() => assertSafeOrtRemovalPath(join(root, 'model-output'), root, { initialCwd }), /protected directory/)
})

test('cleanup keeps the initial cwd protection after the build changes its working directory', async (context) => {
  const parent = await mkdtemp(join(tmpdir(), 'ort-initial-cwd-'))
  context.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'hv-pony-ort-work')
  const buildCwd = join(root, 'onnxruntime')
  await mkdir(buildCwd, { recursive: true })
  const result = spawnSync(
    process.execPath,
    [
      join(import.meta.dirname, 'resolve-ort-build-root.mjs'),
      root,
      '--initial-cwd',
      parent,
      '--check-removal',
      join(root, 'artifacts'),
    ],
    { cwd: buildCwd, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
})
