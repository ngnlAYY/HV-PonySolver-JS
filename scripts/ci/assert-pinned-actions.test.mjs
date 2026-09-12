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

test('checks every action in a YAML flow sequence, including quoted keys and values', async () => {
  for (const second of ['uses: actions/upload-artifact@v7', '"uses": "actions/upload-artifact@v7"']) {
    const result = await runCheckerWithWorkflow(`jobs:
  verify:
    steps: [{ uses: owner/first@${'a'.repeat(40)} }, { ${second} }]
`)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /actions\/upload-artifact@v7/)
  }
})

test('ignores action-like text in quoted strings, comments, and shell block scalars', async () => {
  const result = await runCheckerWithWorkflow(`jobs:
  verify:
    steps:
      - name: 'a description, uses: owner/decoy@main'
        run: |
          echo '{ uses: owner/shell@main }'
          uses: owner/plain-shell@main
      - name: "another description, uses: owner/quoted@main"
        uses: owner/real@${'a'.repeat(40)} # { uses: owner/comment@main }
`)
  assert.equal(result.status, 0, result.stderr)
})

test('scopes inline checkout credentials to their own flow mapping', async () => {
  const valid = await runCheckerWithWorkflow(`jobs:
  verify:
    steps: [{ uses: actions/checkout@${'a'.repeat(40)}, with: { persist-credentials: false } }, { uses: owner/second@${'b'.repeat(40)} }]
`)
  assert.equal(valid.status, 0, valid.stderr)
  const invalid = await runCheckerWithWorkflow(`jobs:
  verify:
    steps: [{ uses: actions/checkout@${'a'.repeat(40)} }, { uses: owner/second@${'b'.repeat(40)}, with: { persist-credentials: false } }]
`)
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /persist-credentials/)
})

test('plain scalar apostrophes do not hide later actions and escaped quoted decoys remain inert', async () => {
  const result = await runCheckerWithWorkflow(`jobs:
  verify:
    steps:
      - name: Check user's source
        uses: owner/action@${'a'.repeat(40)}
      - name: 'quoted ''text'', uses: owner/decoy@main'
        uses: owner/action@main
`)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /owner\/action@main/)
  assert.doesNotMatch(result.stderr, /owner\/decoy/)
})

test('checkout credential checks ignore quoted and block-scalar decoys', async () => {
  for (const settings of [
    `        with: { note: 'example, persist-credentials: false' }`,
    `        with:
          note: |
            persist-credentials: false`,
  ]) {
    const result = await runCheckerWithWorkflow(`jobs:
  verify:
    steps:
      - uses: actions/checkout@${'a'.repeat(40)}
${settings}
`)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /persist-credentials/)
  }
})

test('accepts genuine inline checkout credentials before a trailing comment', async () => {
  const result = await runCheckerWithWorkflow(`jobs:
  verify:
    steps:
      - uses: actions/checkout@${'a'.repeat(40)}
        with: { persist-credentials: false } # checkout credential policy
`)
  assert.equal(result.status, 0, result.stderr)
})

test('checks YAML-escaped action keys and checkout input keys', async () => {
  for (const key of ['"\\u0075ses"', '"\\U00000075ses"', '"\\x75ses"']) {
    const mutable = await runChecker('owner/action@main', `${key}:`)
    assert.notEqual(mutable.status, 0, mutable.stdout)
    const checkout = await runChecker(`actions/checkout@${'a'.repeat(40)}`, `${key}:`)
    assert.notEqual(checkout.status, 0, checkout.stdout)
    assert.match(checkout.stderr, /persist-credentials/)
    const valid = await runCheckerWithWorkflow(`jobs:
  verify:
    steps: [{ ${key}: actions/checkout@${'a'.repeat(40)}, "\\u0077ith": { "\\x70ersist-credentials": false } }]
`)
    assert.equal(valid.status, 0, valid.stderr)
  }
})

test('ignores uses-like tokens inside legal plain scalar values', async () => {
  for (const field of ['name', 'run']) {
    const result = await runCheckerWithWorkflow(`jobs:
  verify:
    steps:
      - ${field}: echo {uses:owner/decoy@main}
        uses: owner/real@${'a'.repeat(40)}
`)
    assert.equal(result.status, 0, result.stderr)
  }
})

test('normalizes escaped block mapping keys without borrowing another steps credentials', async () => {
  const valid = await runCheckerWithWorkflow(`jobs:
  verify:
    steps:
      - "\\u0075ses": actions/checkout@${'a'.repeat(40)}
        "\\U00000077ith":
          "\\u0070ersist-credentials": false
`)
  assert.equal(valid.status, 0, valid.stderr)
  const invalid = await runCheckerWithWorkflow(`jobs:
  verify:
    steps: [{ "\\x75ses": actions/checkout@${'a'.repeat(40)} }, { uses: owner/other@${'b'.repeat(40)}, with: { persist-credentials: false } }]
`)
  assert.notEqual(invalid.status, 0, invalid.stdout)
})

test('fails closed for multiline quoted mapping keys', async () => {
  const result = await runCheckerWithWorkflow(
    'jobs:\n  verify:\n    steps:\n      - "us\\\n          es": owner/action@main\n',
  )
  assert.notEqual(result.status, 0, result.stdout)
})

test('plain scalar continuations cannot manufacture flow mappings', async () => {
  const result = await runCheckerWithWorkflow(`jobs:
  verify:
    steps:
      - run: echo
          {uses:owner/decoy@main}
      - uses: owner/real@${'a'.repeat(40)}
`)
  assert.equal(result.status, 0, result.stderr)
})

test('unsupported anchored mappings and malformed quoted keys fail closed', async () => {
  for (const workflow of [
    'jobs:\n  verify:\n    steps: &steps [{ uses: owner/action@main }]\n',
    'jobs:\n  verify:\n    steps:\n      - "\\qses": owner/action@main\n',
  ]) {
    const result = await runCheckerWithWorkflow(workflow)
    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /unsupported/)
  }
})

test('checkout requires its own direct with input, not a nested mapping lookalike', async () => {
  for (const settings of [
    '        env:\n          with:\n            persist-credentials: false',
    '        with:\n          note:\n            persist-credentials: false',
  ]) {
    const result = await runCheckerWithWorkflow(`jobs:
  verify:
    steps:
      - uses: actions/checkout@${'a'.repeat(40)}
${settings}
`)
    assert.notEqual(result.status, 0, result.stdout)
    assert.match(result.stderr, /persist-credentials/)
  }
})

test('a colon inside a plain flow key does not count as a credentials mapping', async () => {
  const result = await runCheckerWithWorkflow(`jobs:
  verify:
    steps: [{ uses: actions/checkout@${'a'.repeat(40)}, with: { persist-credentials:false } }]
`)
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /persist-credentials/)
})

test('normalizes escaped action and credential scalar values before checking checkout', async () => {
  for (const escape of ['\\x61', '\\u0061', '\\U00000061']) {
    const checkout = `"${escape}ctions/checkout@${'a'.repeat(40)}"`
    const missing = await runChecker(checkout)
    assert.notEqual(missing.status, 0, missing.stdout)
    assert.match(missing.stderr, /persist-credentials/)
    const valid = await runCheckerWithWorkflow(`jobs:
  verify:
    steps: [{ uses: ${checkout}, with: { persist-credentials: "\\x66alse" } }]
`)
    assert.equal(valid.status, 0, valid.stderr)
  }
})

test('does not shorten credential scalar strings to false and rejects unsupported action scalars', async () => {
  for (const credential of ['"false #text"', "'false #text'", 'false text']) {
    const result = await runCheckerWithWorkflow(`jobs:
  verify:
    steps:
      - uses: actions/checkout@${'a'.repeat(40)}
        with:
          persist-credentials: ${credential}
`)
    assert.notEqual(result.status, 0, result.stdout)
  }
  for (const value of [
    '"\\qctions/checkout@' + 'a'.repeat(40) + '"',
    '"actions/\\\n          checkout@' + 'a'.repeat(40) + '"',
  ]) {
    const result = await runChecker(value)
    assert.notEqual(result.status, 0, result.stdout)
  }
})
