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

test('rejects model HEAD as the client Key verification protocol', async () => {
  await withFixture(async (root) => {
    const path = join(root, 'docs/browser-extension.md')
    const source = await readFile(path, 'utf8')
    const row = source.split(/\r?\n/u).find((line) => /^\|\s*验证并保存\s*\|/u.test(line))
    assert.ok(row?.includes('GET /quota'), 'fixture must document quota-based Key validation')
    const modified = source.replace(row, row.replace('GET /quota', 'HEAD /yolo26n-640.ort'))
    assert.notEqual(modified, source)
    await writeFile(path, modified)

    const result = await runCheck(root)
    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /Key validation must document GET \/quota instead of model HEAD/u)
  })
})

test('extension security contracts belong in the topic document', async () => {
  const facts = ['sender.url', '不传递 Playwright call log', 'confirm-idle', 'OFFSCREEN_CONTROL_TIMEOUT_MS']
  await withFixture(async (root) => {
    const path = join(root, 'docs/browser-extension.md')
    let source = await readFile(path, 'utf8')
    for (const fact of facts) {
      assert.ok(source.includes(fact), `fixture must document ${fact}`)
      source = source.replaceAll(fact, 'omitted-security-fact')
    }
    await writeFile(path, source)
    const readmePath = join(root, 'README.md')
    await writeFile(readmePath, `${await readFile(readmePath, 'utf8')}\n${facts.join('\n')}\n`)

    const result = await runCheck(root)
    assert.equal(result.exitCode, 1)
    for (const fact of facts) {
      assert.ok(result.stderr.includes(`extension documentation omits ${fact}`), result.stderr)
    }
  })
})
