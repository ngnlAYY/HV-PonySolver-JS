import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { readFile, runCheck, withFixture, writeFile } from './fixtures.mjs'

test('extension documentation tracks the authoritative nested entry paths', async () => {
  await withFixture(async (root) => {
    const baseline = await runCheck(root)
    assert.equal(baseline.exitCode, 0, baseline.stderr)
    const path = join(root, 'docs/browser-extension.md')
    const source = await readFile(path, 'utf8')
    await writeFile(path, source.replaceAll('options/options.html', 'options.html'))
    const result = await runCheck(root)
    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /extension documentation omits entry path options\/options.html/)
  })
})
