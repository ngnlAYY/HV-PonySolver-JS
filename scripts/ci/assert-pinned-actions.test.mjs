import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'assert-pinned-actions.mjs')

async function runCheckerWithWorkflow(workflow) {
  const root = await mkdtemp(join(tmpdir(), 'hv-pinned-actions-'))
  try {
    await mkdir(join(root, 'scripts', 'ci'), { recursive: true })
    await mkdir(join(root, '.github', 'workflows'), { recursive: true })
    await copyFile(scriptPath, join(root, 'scripts', 'ci', 'assert-pinned-actions.mjs'))
    await writeFile(join(root, '.github', 'workflows', 'verify.yml'), workflow)
    return spawnSync(process.execPath, [join(root, 'scripts', 'ci', 'assert-pinned-actions.mjs')], {
      encoding: 'utf8',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function runChecker(uses, usesKey = 'uses:', usesSuffix = '') {
  return runCheckerWithWorkflow(`jobs:\n  verify:\n    steps:\n      - ${usesKey} ${uses}${usesSuffix}\n`)
}

test('accepts Docker action images pinned to a full sha256 digest', async () => {
  const result = await runChecker(`docker://alpine@sha256:${'a'.repeat(64)}`)

  assert.equal(result.status, 0, result.stderr)
})

test('rejects mutable Docker action image tags', async () => {
  const result = await runChecker('docker://alpine:latest')

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /docker:\/\/alpine:latest/)
})

test('rejects mutable action tags when YAML separates the uses key from its colon', async () => {
  const result = await runChecker('actions/checkout@v7', 'uses :')

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /actions\/checkout@v7/)
})

test('rejects mutable action tags behind a quoted YAML uses key', async () => {
  const result = await runChecker('actions/checkout@v7', '"uses":')

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /actions\/checkout@v7/)
})

test('rejects mutable action tags inside a YAML flow mapping', async () => {
  const result = await runChecker('actions/checkout@v7', '{ uses:', ' }')

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /actions\/checkout@v7/)
})

test('rejects mutable action tags inside a nested YAML flow sequence', async () => {
  const result = await runCheckerWithWorkflow('jobs:\n  verify:\n    steps: [{ uses: actions/checkout@v7 }]\n')

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /actions\/checkout@v7/)
})

test('rejects mutable action tags in a multiline YAML scalar', async () => {
  const result = await runCheckerWithWorkflow(
    'jobs:\n  verify:\n    steps:\n      - uses:\n          actions/checkout@v7\n',
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /actions\/checkout@v7/)
})

test('accepts a multiline action pinned to a full commit SHA', async () => {
  const result = await runCheckerWithWorkflow(
    `jobs:\n  verify:\n    steps:\n      - uses:\n          actions/checkout@${'a'.repeat(40)}\n        with:\n          persist-credentials: false\n`,
  )

  assert.equal(result.status, 0, result.stderr)
})

test('rejects mutable actions declared with an explicit YAML mapping key', async () => {
  const result = await runCheckerWithWorkflow(
    'jobs:\n  verify:\n    steps:\n      - ? uses\n        : actions/checkout@v7\n',
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /actions\/checkout@v7/)
})

test('rejects checkout steps that omit persist-credentials', async () => {
  const result = await runCheckerWithWorkflow(
    `jobs:\n  verify:\n    steps:\n      - uses: actions/checkout@${'a'.repeat(40)}\n`,
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /persist-credentials.*false/)
})

test('rejects checkout steps that persist credentials', async () => {
  const result = await runCheckerWithWorkflow(
    `jobs:\n  verify:\n    steps:\n      - uses: actions/checkout@${'a'.repeat(40)}\n        with:\n          persist-credentials: true\n`,
  )

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /persist-credentials.*false/)
})

test('accepts checkout steps with credential persistence disabled', async () => {
  const result = await runCheckerWithWorkflow(
    `jobs:\n  verify:\n    steps:\n      - uses: actions/checkout@${'a'.repeat(40)}\n        with:\n          persist-credentials: false\n`,
  )

  assert.equal(result.status, 0, result.stderr)
})
