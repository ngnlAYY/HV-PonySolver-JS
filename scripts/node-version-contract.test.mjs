import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

const repoRoot = resolve(import.meta.dirname, '..')
const expectedNodeVersion = '24.15.0'

test('local package metadata and every setup-node step pin the same Node version', async () => {
  const [nodeVersion, packageSource, ...workflows] = await Promise.all([
    readFile(resolve(repoRoot, '.node-version'), 'utf8'),
    readFile(resolve(repoRoot, 'package.json'), 'utf8'),
    readFile(resolve(repoRoot, '.github/workflows/verify-monorepo.yml'), 'utf8'),
    readFile(resolve(repoRoot, '.github/workflows/deploy-cloudflare-model-worker.yml'), 'utf8'),
  ])
  const packageJson = JSON.parse(packageSource)

  assert.equal(nodeVersion.trim(), expectedNodeVersion)
  assert.equal(packageJson.engines?.node, `>=${expectedNodeVersion}`)
  for (const workflow of workflows) {
    const setupCount = [...workflow.matchAll(/uses: actions\/setup-node@/g)].length
    const versionFileCount = [...workflow.matchAll(/node-version-file: '\.node-version'/g)].length
    assert.ok(setupCount > 0)
    assert.equal(versionFileCount, setupCount)
  }
})
