import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { readFile, runCheck, withFixture, writeFile } from './fixtures.mjs'

test('fails clearly when HTTP reference documents query-string model key authorization', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\nGET /yolo26n-640.onnx?key=<authorized-64-hex> returns real model.\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(
      result.stderr,
      /docs\/reference\/model-worker-http.md.*query-string key authorization or real model access/s,
    )
  })
})

test('fails clearly when HTTP reference documents query-string model key authorization on any model path', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\nGET /models/custom.onnx?key=<authorized-64-hex> returns real model.\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(
      result.stderr,
      /docs\/reference\/model-worker-http.md.*query-string key authorization or real model access/s,
    )
  })
})

test('fails clearly when HTTP reference says query-string key returns the real model in Chinese', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\nquery string key 返回真实模型。\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(
      result.stderr,
      /docs\/reference\/model-worker-http.md.*query-string key authorization or real model access/s,
    )
  })
})

test('fails clearly when HTTP reference URL query key returns the real model in Chinese', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\nGET /yolo26n-640.onnx?key=<authorized-64-hex> 返回真实模型。\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(
      result.stderr,
      /docs\/reference\/model-worker-http.md.*query-string key authorization or real model access/s,
    )
  })
})

for (const queryKeyWording of [
  'search param key returns real model.',
  'query parameter key returns the real model.',
  'URL parameter key authorizes real model.',
  'query-string key returns the real model.',
  'key query string returns the real model.',
  'query string key authorizes access to the real model.',
  'query string key returns a real model.',
  'query string key returns `200` real model.',
  'query string key returns 200, real model.',
]) {
  test(`fails clearly when HTTP reference documents ${queryKeyWording}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
      const readme = await readFile(readmePath, 'utf8')
      await writeFile(readmePath, `${readme}\n${queryKeyWording}\n`)

      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(
        result.stderr,
        /docs\/reference\/model-worker-http.md.*query-string key authorization or real model access/s,
      )
    })
  })
}

test('does not reject query-string key denial wording as real model access', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\n只提供 query string key，不返回真实模型；按缺少 Bearer token 处理。\n`)

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})

test('does not reject query-string key English denial wording as real model access', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(
      readmePath,
      `${readme}\nquery string key cannot return the real model; treat it as missing Bearer token.\n`,
    )

    const result = await runCheck(fixtureRoot)
    assert.equal(result.exitCode, 0, result.stderr)
  })
})

for (const queryKeyDenialWording of [
  'must not return the real model; treat it as missing Bearer token.',
  'should not authorize the real model; treat it as missing Bearer token.',
  'never grants access to the real model; treat it as missing Bearer token.',
  'cannot grant access to the real model; treat it as missing Bearer token.',
  '不会授权真实模型；按缺少 Bearer token 处理',
  '不能返回真实模型；按缺少 Bearer token 处理',
  'can not authorize access to a real model; treat it as missing Bearer token.',
  'does not authorize access to a real model; treat it as missing Bearer token.',
]) {
  test(`accepts query-string key denial wording: ${queryKeyDenialWording}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
      const readme = await readFile(readmePath, 'utf8')
      assert.ok(readme.includes('不授权真实模型；按缺少 Bearer token 处理'))
      await writeFile(readmePath, readme.replace('不授权真实模型；按缺少 Bearer token 处理', queryKeyDenialWording))

      const result = await runCheck(fixtureRoot)
      assert.equal(result.exitCode, 0, result.stderr)
    })
  })
}

for (const positiveGrantAccessWording of [
  'query string key grants access to the real model.',
  'query string key can grant access to the real model.',
  'query string key should grant access to the real model.',
]) {
  test(`fails clearly when HTTP reference says ${positiveGrantAccessWording}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
      const readme = await readFile(readmePath, 'utf8')
      await writeFile(readmePath, `${readme}\n${positiveGrantAccessWording}\n`)

      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(
        result.stderr,
        /docs\/reference\/model-worker-http.md.*query-string key authorization or real model access/s,
      )
    })
  })
}

test('fails when query-string key denial line also contains positive grant access claim', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(
      readmePath,
      `${readme}\nquery string key cannot grant access to the real model, but a debug ?key grants access to the real model.\n`,
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(
      result.stderr,
      /docs\/reference\/model-worker-http.md.*query-string key authorization or real model access/s,
    )
  })
})

for (const bearerContrastWording of [
  'query string key does not authorize the real model; Authorization: Bearer returns the real model.',
  'query string key does not authorize access to a real model, while Bearer token authorizes access to the real model.',
  'query string key does not authorize access to a real model, Authorization: Bearer returns the real model.',
]) {
  test(`accepts Bearer contrast wording: ${bearerContrastWording}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
      const readme = await readFile(readmePath, 'utf8')
      await writeFile(readmePath, `${readme}\n${bearerContrastWording}\n`)

      const result = await runCheck(fixtureRoot)
      assert.equal(result.exitCode, 0, result.stderr)
    })
  })
}

test('fails clearly when HTTP reference says query-string key authorizes the real model', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('不授权真实模型；按缺少 Bearer token 处理'))
    await writeFile(
      readmePath,
      readme.replace('不授权真实模型；按缺少 Bearer token 处理', '授权真实模型；返回 200 真实模型'),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(
      result.stderr,
      /docs\/reference\/model-worker-http.md.*query-string key does not authorize the real model/s,
    )
    assert.match(
      result.stderr,
      /docs\/reference\/model-worker-http.md.*query-string key authorization or real model access/s,
    )
  })
})

test('fails clearly when HTTP reference 405 docs omit OPTIONS from the Allow header row', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('`405 Method Not Allowed`，`Allow: GET, HEAD, OPTIONS`'))
    await writeFile(
      readmePath,
      readme.replace(
        '`405 Method Not Allowed`，`Allow: GET, HEAD, OPTIONS`',
        '`405 Method Not Allowed`，`Allow: GET, HEAD`',
      ),
    )

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(
      result.stderr,
      /docs\/reference\/model-worker-http.md.*405 docs must mention Allow: GET, HEAD, OPTIONS/s,
    )
    assert.match(result.stderr, /docs\/reference\/model-worker-http.md.*stale Allow: GET, HEAD semantics/s)
  })
})

test('fails clearly when HTTP reference documents stale Model Worker cache-control semantics', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
    const readme = await readFile(readmePath, 'utf8')
    await writeFile(readmePath, `${readme}\nStale example: Cache-Control: public, max-age=86400.\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/reference\/model-worker-http.md.*Cache-Control: public, max-age=86400/s)
  })
})

test('fails clearly when HTTP reference selected R2 miss row omits Internal Server Error', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/reference/model-worker-http.md')
    const readme = await readFile(readmePath, 'utf8')
    const mutatedReadme = readme.replace(
      /^\|\s*选中的 R2 object 缺失\s*\|\s*`500 Internal Server Error`\s*\|$/m,
      '| 选中的 R2 object 缺失 | `404 Not Found` |',
    )
    assert.notEqual(mutatedReadme, readme, 'fixture should contain the selected R2 object missing row')
    await writeFile(readmePath, mutatedReadme)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(
      result.stderr,
      /docs\/reference\/model-worker-http.md.*selected R2 object missing docs must mention 500 Internal Server Error/s,
    )
  })
})

const architectureGuardrailTerms = ['architecture:check', 'inferenceTimeoutConfig', 'StatusPanel', 'Model Worker Core']

for (const requiredTerm of architectureGuardrailTerms) {
  test(`fails clearly when architecture overview guardrails omit ${requiredTerm}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const readmePath = join(fixtureRoot, 'docs/architecture/overview.md')
      const readme = await readFile(readmePath, 'utf8')
      assert.ok(readme.includes(requiredTerm), `fixture should mention ${requiredTerm}`)
      await writeFile(readmePath, readme.replaceAll(requiredTerm, 'omitted architecture guardrail'))

      const escapedTerm = requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(result.stderr, new RegExp(`docs/architecture/overview\\.md.*${escapedTerm}`, 's'))
    })
  })
}
