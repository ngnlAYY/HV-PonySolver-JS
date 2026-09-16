import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { checkCommandExamples } from '../readme-commands.mjs'
import { readFile, runCheck, runCliCheck, withFixture, writeFile } from './fixtures.mjs'

for (const [path, term] of [
  ['docs/architecture/browser-runtime.md', 'workerDetectTimeoutMs'],
  ['docs/onnx-runtime.md', 'externalFullRuntime.sha256'],
  ['docs/architecture/overview.md', 'Model Worker Core'],
]) {
  test(`README cannot mask a missing contract in ${path}`, async () => {
    await withFixture(async (root) => {
      const target = join(root, path)
      const original = await readFile(target, 'utf8')
      assert.ok(original.includes(term))
      await writeFile(target, original.replaceAll(term, 'missing-contract'))
      await writeFile(join(root, 'README.md'), `${await readFile(join(root, 'README.md'), 'utf8')}\n${original}`)
      const result = await runCheck(root)
      assert.notEqual(result.exitCode, 0)
      assert.ok(result.stderr.includes(path))
      assert.ok(result.stderr.includes(term))
    })
  })
}

test('CLI fails closed when the HTTP reference is missing', async () => {
  await withFixture(
    async (root) => {
      await rm(join(root, 'docs/reference/model-worker-http.md'))
      const result = await runCliCheck(root)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, /model-worker-http\.md/u)
    },
    { materialize: true },
  )
})

test('copyable commands in usage guides reject unknown workspace names', async () => {
  await withFixture(async (root) => {
    const path = join(root, 'docs/usage/userscript.md')
    await writeFile(
      path,
      (await readFile(path, 'utf8')).replaceAll('@hv-pony-solver/userscript', '@hv-pony-solver/typo'),
    )
    const result = await runCheck(root)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/usage\/userscript\.md.*unknown pnpm workspace filter/u)
  })
})

test('command examples cover shell fences and inline code, keeping exec and prose distinct', () => {
  const root = { name: 'root', scripts: { check: 'test' } }
  const workspace = { name: '@example/app', scripts: { test: 'test' } }
  const source = [
    '`mise exec -- pnpm check`',
    '```bash',
    'mise exec -- pnpm --filter @example/app run test',
    'pnpm exec prettier --check README.md',
    'pnpm missing-command',
    '```',
    '```text',
    'pnpm illustrative-prose',
    '```',
    '`pnpm --filter @example/app missing-test`',
  ].join('\n')
  const errors = checkCommandExamples(root, [workspace], source, 'guide.md')
  assert.equal(errors.length, 2)
  assert.match(errors[0], /missing-command/u)
  assert.match(errors[1], /missing-test/u)
})
