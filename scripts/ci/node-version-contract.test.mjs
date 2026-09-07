import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

const repoRoot = resolve(import.meta.dirname, '../..')
const expectedNodeVersion = '24.15.0'
const expectedPnpmVersion = '12.3.0'

test('mise pins Node and pnpm consistently with package metadata', async () => {
  const [miseSource, packageSource] = await Promise.all([
    readFile(resolve(repoRoot, 'mise.toml'), 'utf8'),
    readFile(resolve(repoRoot, 'package.json'), 'utf8'),
  ])
  const packageJson = JSON.parse(packageSource)
  const toolsSource = miseSource.split(/^\[tools\][ \t]*$/mu)[1]?.split(/^\[/mu)[0] ?? ''

  assert.equal(/^node\s*=\s*"(?<version>[^"]+)"/mu.exec(toolsSource)?.groups?.version, expectedNodeVersion)
  assert.equal(/^pnpm\s*=\s*"(?<version>[^"]+)"/mu.exec(toolsSource)?.groups?.version, expectedPnpmVersion)
  assert.equal(packageJson.engines?.node, `>=${expectedNodeVersion}`)
  assert.equal(packageJson.packageManager, `pnpm@${expectedPnpmVersion}`)
  await assert.rejects(readFile(resolve(repoRoot, '.node-version')), { code: 'ENOENT' })
})

for (const name of ['verify-monorepo.yml', 'deploy-cloudflare-model-worker.yml']) {
  test(`${name} installs repository tools with mise and preserves conditional dependency caching`, async () => {
    const workflow = await readFile(resolve(repoRoot, '.github/workflows', name), 'utf8')
    assert.doesNotMatch(workflow, /actions\/setup-node|pnpm\/action-setup|\bcorepack\b|\.node-version/u)
    const jobs = workflow.slice(workflow.indexOf('\njobs:\n')).split(/(?=^ {2}[\w-]+:\s*$)/mu)
    let setupCount = 0
    for (const job of jobs) {
      if (!/\b(?:pnpm|node)\b/u.test(job)) continue
      const steps = job.split(/(?=^ {6}- name:)/mu)
      const setupSteps = steps.filter((step) => step.includes('uses: jdx/mise-action@'))
      assert.equal(setupSteps.length, 1, `${job.split('\n')[0]} must set up mise exactly once`)
      const setupStep = setupSteps[0]
      setupCount += 1
      assert.match(setupStep, /uses: jdx\/mise-action@[a-f0-9]{40}\b/u)
      assert.match(setupStep, /version: '\d+\.\d+\.\d+'/u)
      assert.doesNotMatch(setupStep, /mise_toml:|tool_versions:|install: false/u)

      const installStep = steps.find((step) => /run: pnpm install\b/u.test(step))
      if (!installStep) {
        assert.match(setupStep, /install_args: node/u)
        continue
      }
      assert.match(installStep, /run: pnpm install --frozen-lockfile/u)
      const storeStep = steps.find((step) => step.includes('id: pnpm-store'))
      const cacheStep = steps.find((step) => step.includes('name: Cache pnpm store'))
      assert.ok(storeStep)
      assert.ok(cacheStep)
      assert.match(storeStep, /pnpm store path --silent/u)
      assert.match(cacheStep, /path: \$\{\{ steps\.pnpm-store\.outputs\.path \}\}/u)
      assert.match(cacheStep, /hashFiles\('mise\.toml', 'pnpm-lock\.yaml'\)/u)
      assert.ok(steps.indexOf(setupStep) < steps.indexOf(storeStep))
      assert.ok(steps.indexOf(storeStep) < steps.indexOf(cacheStep))
      assert.ok(steps.indexOf(cacheStep) < steps.indexOf(installStep))
      const installCondition = /^ {8}if: (.+)$/mu.exec(installStep)?.[1]
      for (const step of [setupStep, storeStep, cacheStep]) {
        assert.equal(/^ {8}if: (.+)$/mu.exec(step)?.[1], installCondition)
      }
    }
    assert.ok(setupCount > 0)
  })
}

test('workspace scripts use the pnpm selected by mise without requiring Corepack', async () => {
  const packages = [
    'package.json',
    'apps/extension/package.json',
    'apps/userscript/package.json',
    'apps/model-worker/package.json',
    'packages/browser-core/package.json',
    'packages/shared/package.json',
  ]
  for (const file of packages) {
    const packageJson = JSON.parse(await readFile(resolve(repoRoot, file), 'utf8'))
    assert.doesNotMatch(Object.values(packageJson.scripts).join('\n'), /\bcorepack\b/iu, file)
  }
})
