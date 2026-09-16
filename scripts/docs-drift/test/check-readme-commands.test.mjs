import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { readFile, runCheck, withFixture, writeFile } from './fixtures.mjs'

test('fails clearly when pnpm check references a missing check:quick script', async () => {
  await withFixture(async (fixtureRoot) => {
    const packageJsonPath = join(fixtureRoot, 'package.json')
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
    delete packageJson.scripts['check:quick']
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /package\.json scripts\.check:quick is missing/s)
  })
})

test('fails clearly when command reference omits format:check from pnpm check:quick', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/development/commands.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('`pnpm check:quick`'))
    assert.ok(readme.includes('format:check'))
    await writeFile(readmePath, readme.replaceAll('format:check', 'omitted format command'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(
      result.stderr,
      /docs\/development\/commands\.md pnpm check:quick description must mention format:check/s,
    )
  })
})

test('fails clearly when command reference documents a root pnpm command that does not exist', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/development/commands.md')
    const readme = await readFile(readmePath, 'utf8')
    assert.ok(readme.includes('`pnpm test:e2e:userscript`'))
    await writeFile(readmePath, readme.replace('`pnpm test:e2e:userscript`', '`pnpm command-that-does-not-exist`'))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(result.stderr, /docs\/development\/commands\.md.*command-that-does-not-exist.*package\.json/s)
  })
})

test('fails clearly when command reference documents a filtered workspace command that does not exist', async () => {
  await withFixture(async (fixtureRoot) => {
    const readmePath = join(fixtureRoot, 'docs/development/commands.md')
    const readme = await readFile(readmePath, 'utf8')
    const documentedCommand = 'pnpm --filter @hv-pony-solver/extension test:e2e:packaged'
    assert.ok(readme.includes(documentedCommand))
    await writeFile(readmePath, readme.replace(documentedCommand, `${documentedCommand}-missing`))

    const result = await runCheck(fixtureRoot)
    assert.notEqual(result.exitCode, 0)
    assert.match(
      result.stderr,
      /docs\/development\/commands\.md.*@hv-pony-solver\/extension.*test:e2e:packaged-missing/s,
    )
  })
})

for (const [relativePath, term, label] of [
  ['docs/onnx-runtime.md', 'ONNX_RUNTIME_ASSETS', 'ONNX Runtime'],
  ['docs/model-cache-strategy.md', 'POST /quota', 'model cache'],
]) {
  test(`fails clearly when the ${label} supplemental document drops ${term}`, async () => {
    await withFixture(async (fixtureRoot) => {
      const documentPath = join(fixtureRoot, relativePath)
      const document = await readFile(documentPath, 'utf8')
      assert.ok(document.includes(term))
      await writeFile(documentPath, document.replaceAll(term, 'omitted supplemental contract'))

      const result = await runCheck(fixtureRoot)
      assert.notEqual(result.exitCode, 0)
      assert.match(
        result.stderr,
        new RegExp(
          `${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          's',
        ),
      )
    })
  })
}
