import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { access, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'

const scriptUrl = new URL('./build-minimal-ort-runtime.sh', import.meta.url)

test('rejects invalid arguments before creating an ORT build root from an arbitrary cwd', async (t) => {
  const temporaryParent = await mkdtemp(join(tmpdir(), 'build-minimal-ort-runtime-'))
  const cwd = join(temporaryParent, 'arbitrary-cwd')
  const buildRoot = join(temporaryParent, 'hv-pony-ort-entry-smoke')
  t.after(() => rm(temporaryParent, { recursive: true, force: true }))
  await mkdir(cwd)

  for (const args of [['--invalid-option'], ['--install', '--invalid-option'], ['--install', '--install']]) {
    const result = spawnSync('bash', [fileURLToPath(scriptUrl), ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ORT_BUILD_ROOT: buildRoot },
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 2)
    const output = `${result.stdout}\n${result.stderr}`
    assert.match(output, /Usage:/u)
    assert.doesNotMatch(output, /MODULE_NOT_FOUND/u)
    await assert.rejects(access(buildRoot), { code: 'ENOENT' })
  }
})

test('leaves an external file untouched when an old lock path is a symbolic link', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'ort-lock-symlink-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'hv-pony-ort-work')
  const bin = join(parent, 'bin')
  const marker = join(parent, 'outside-must-survive.txt')
  await mkdir(root)
  await mkdir(bin)
  await writeFile(marker, 'preserve this unrelated file')
  await symlink(marker, join(root, '.build.lock'))
  await writeFile(join(bin, 'git'), '#!/bin/sh\nexit 42\n', { mode: 0o755 })

  const result = spawnSync('bash', [fileURLToPath(scriptUrl)], {
    cwd: parent,
    encoding: 'utf8',
    env: { ...process.env, ORT_BUILD_ROOT: root, PATH: `${bin}:${process.env.PATH}` },
    timeout: 5_000,
  })

  assert.equal(result.error, undefined)
  assert.equal(result.status, 42, result.stderr)
  assert.equal(await readFile(marker, 'utf8'), 'preserve this unrelated file')
  assert.equal(await readFile(join(root, '.build.lock'), 'utf8'), 'preserve this unrelated file')
})

test('concurrent builds share the directory lock even with an old lock symlink', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'ort-lock-concurrency-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'hv-pony-ort-work')
  const bin = join(parent, 'bin')
  const ready = join(parent, 'git-started')
  const release = join(parent, 'release-git')
  const marker = join(parent, 'outside-must-survive.txt')
  await mkdir(root)
  await mkdir(bin)
  await writeFile(marker, 'preserve this unrelated file')
  await symlink(marker, join(root, '.build.lock'))
  await writeFile(
    join(bin, 'git'),
    '#!/bin/sh\nprintf ready > "$ORT_LOCK_TEST_READY"\nwhile [ ! -f "$ORT_LOCK_TEST_RELEASE" ]; do sleep 0.01; done\nexit 42\n',
    { mode: 0o755 },
  )
  const options = {
    cwd: parent,
    env: {
      ...process.env,
      ORT_BUILD_ROOT: root,
      ORT_LOCK_TEST_READY: ready,
      ORT_LOCK_TEST_RELEASE: release,
      PATH: `${bin}:${process.env.PATH}`,
    },
  }
  const first = spawn('bash', [fileURLToPath(scriptUrl)], { ...options, stdio: 'ignore' })
  const firstExit = new Promise((resolve, reject) => {
    first.once('error', reject)
    first.once('exit', resolve)
  })
  try {
    let started = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await access(ready)
        started = true
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await delay(20)
      }
    }
    assert.equal(started, true, 'first build must reach the inert git stub while holding the lock')
    const second = spawnSync('bash', [fileURLToPath(scriptUrl)], {
      ...options,
      encoding: 'utf8',
      timeout: 2_000,
    })
    assert.equal(second.error, undefined)
    assert.equal(second.status, 1)
    assert.match(second.stderr, /Another ORT build is already using/u)
    assert.equal(await readFile(marker, 'utf8'), 'preserve this unrelated file')
  } finally {
    await writeFile(release, 'release')
    await firstExit
  }
  assert.equal(await firstExit, 42)
  const next = spawnSync('bash', [fileURLToPath(scriptUrl)], { ...options, encoding: 'utf8', timeout: 2_000 })
  assert.equal(next.error, undefined)
  assert.equal(next.status, 42, next.stderr)
  assert.equal(await readFile(marker, 'utf8'), 'preserve this unrelated file')
})

test('rejects an initial cwd below a temporary build root before creating build state', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'ort-build-cwd-entry-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'hv-pony-ort-work')
  const cwd = join(root, 'model-output')
  await mkdir(cwd, { recursive: true })
  const marker = join(cwd, 'source-must-survive.ts')
  await writeFile(marker, 'user source')

  const result = spawnSync('bash', [fileURLToPath(scriptUrl)], {
    cwd,
    env: { ...process.env, ORT_BUILD_ROOT: root },
    encoding: 'utf8',
  })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /protected directory/)
  assert.equal(await readFile(marker, 'utf8'), 'user source')
  await assert.rejects(access(join(root, '.build.lock')), { code: 'ENOENT' })
})

test('rejects a build root containing the repository when launched from an unrelated cwd', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'ort-build-repo-entry-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'hv-pony-ort-work')
  const repository = join(root, 'js-build', 'project-checkout')
  const scripts = join(repository, 'scripts', 'ort-runtime')
  await mkdir(scripts, { recursive: true })
  for (const file of ['build-minimal-ort-runtime.sh', 'resolve-ort-build-root.mjs']) {
    await copyFile(join(import.meta.dirname, file), join(scripts, file))
  }
  const marker = join(repository, 'source-must-survive.ts')
  await writeFile(marker, 'user source')

  const result = spawnSync('bash', [join(scripts, 'build-minimal-ort-runtime.sh')], {
    cwd: parent,
    env: { ...process.env, ORT_BUILD_ROOT: root },
    encoding: 'utf8',
  })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /protected directory/)
  assert.equal(await readFile(marker, 'utf8'), 'user source')
  await assert.rejects(access(join(root, '.build.lock')), { code: 'ENOENT' })
})
