import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { runCliCheck, withFixture, writeFile } from './fixtures.mjs'

test('CLI honors --repo-root and reports contract failures on stderr', async () => {
  await withFixture(
    async (root) => {
      await writeFile(join(root, 'README.md'), '# Missing contracts\n')
      const result = await runCliCheck(root)
      assert.equal(result.exitCode, 1)
      assert.match(result.stderr, /Docs drift:/)
    },
    { materialize: true },
  )
})
