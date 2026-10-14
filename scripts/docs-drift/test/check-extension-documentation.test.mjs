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

// 同一逐词校验只抽查代表事实；来源隔离和秘密脱敏本身由扩展行为测试负责。
for (const fact of ['sender.url', '不传递 Playwright call log']) {
  test(`extension security contract belongs in its topic document: ${fact}`, async () => {
    await withFixture(async (root) => {
      const path = join(root, 'docs/browser-extension.md')
      const source = await readFile(path, 'utf8')
      assert.ok(source.includes(fact), `fixture must document ${fact}`)
      await writeFile(path, source.replaceAll(fact, 'omitted-security-fact'))
      const readmePath = join(root, 'README.md')
      await writeFile(readmePath, `${await readFile(readmePath, 'utf8')}\n${fact}\n`)

      const result = await runCheck(root)
      assert.equal(result.exitCode, 1)
      assert.ok(result.stderr.includes(`extension documentation omits ${fact}`), result.stderr)
    })
  })
}
