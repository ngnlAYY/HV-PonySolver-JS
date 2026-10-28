import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

const repoRoot = resolve(import.meta.dirname, '../..')

const rootImporterDependencyPattern = /^ {6}(?:"([^"]+)"|'([^']+)'|([^:\s]+)):\s*$/u

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

test('pnpm workspace has one fail-closed root lockfile document', async () => {
  const [workspaceSource, lockSource, packageSource] = await Promise.all([
    readFile(resolve(repoRoot, 'pnpm-workspace.yaml'), 'utf8'),
    readFile(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8'),
    readFile(resolve(repoRoot, 'package.json'), 'utf8'),
  ])
  const pmOnFailEntries = workspaceSource.match(/^pmOnFail:.*$/gmu) ?? []
  assert.deepEqual(pmOnFailEntries, ['pmOnFail: ignore'])
  assert.match(workspaceSource, /^blockExoticSubdeps:\s*true$/mu)
  assert.match(workspaceSource, /^minimumReleaseAge:\s*10080$/mu)
  assert.match(workspaceSource, /^trustPolicy:\s*no-downgrade$/mu)
  assert.match(workspaceSource, /^trustPolicyIgnoreAfter:\s*10080$/mu)

  const documentMarkers = lockSource.match(/^---$/gmu) ?? []
  assert.equal(documentMarkers.length, 0)
  assert.ok(lockSource.startsWith('lockfileVersion:'))
  const rootImporter = /^importers:\n(?:\n)* {2}\.:\n(?<body>(?: {4}.*(?:\n|$)|\n)*)/mu.exec(lockSource)?.groups?.body
  assert.ok(rootImporter)

  const rootPackage = JSON.parse(packageSource)
  const rootDependencyNames = Object.keys({
    ...rootPackage.dependencies,
    ...rootPackage.devDependencies,
    ...rootPackage.optionalDependencies,
  })
  assert.ok(rootDependencyNames.length > 0)
  const rootImporterLines = rootImporter.split(/\r?\n/u)
  assert.ok(
    rootDependencyNames.some((name) =>
      rootImporterLines.some((line) => {
        const match = rootImporterDependencyPattern.exec(line)
        return (match?.[1] ?? match?.[2] ?? match?.[3]) === name
      }),
    ),
  )
})
