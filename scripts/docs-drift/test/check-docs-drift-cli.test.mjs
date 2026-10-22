import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { runCheck, runCliCheck, withFixture, writeFile } from './fixtures.mjs'

test('CLI honors --repo-root and reports contract failures on stderr', async () => {
  await withFixture(
    async (root) => {
      await writeFile(join(root, 'docs/development/commands.md'), '# Missing contracts\n')
      const result = await runCliCheck(root)
      assert.equal(result.exitCode, 1)
      assert.match(result.stderr, /Docs drift:/)
    },
    { materialize: true },
  )
})

test('later checks observe edited contracts instead of reusing a stale snapshot', async () => {
  await withFixture(async (root) => {
    assert.equal((await runCheck(root)).exitCode, 0)

    await writeFile(join(root, 'docs/development/commands.md'), '# Missing contracts\n')
    const result = await runCheck(root)
    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /docs\/development\/commands\.md/)
  })
})
