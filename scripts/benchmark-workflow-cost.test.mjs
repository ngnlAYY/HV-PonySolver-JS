import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { URL } from 'node:url'

const repositoryRoot = new URL('../', import.meta.url)

test('keeps the default extension benchmark bounded and leaves the full matrix explicit', async () => {
  const rootPackage = JSON.parse(await readFile(new URL('package.json', repositoryRoot), 'utf8'))
  const extensionPackage = JSON.parse(await readFile(new URL('apps/extension/package.json', repositoryRoot), 'utf8'))

  assert.match(extensionPackage.scripts.benchmark, /--ci/u)
  assert.match(extensionPackage.scripts['benchmark:full'], /benchmark-runner\.mjs/u)
  assert.doesNotMatch(extensionPackage.scripts['benchmark:full'], /--ci|--quick/u)
  assert.match(rootPackage.scripts['benchmark:extension:full'], /benchmark:full/u)
})

test('builds the remote extension once for both load-only smokes in the shared CI job', async () => {
  const workflow = await readFile(new URL('.github/workflows/verify-monorepo.yml', repositoryRoot), 'utf8')
  const extensionJob = workflow.match(/\n {2}extension-e2e:[\s\S]*?(?=\n {2}extension-remote-authenticated-e2e:)/u)?.[0]
  assert.ok(extensionJob)

  assert.equal(extensionJob.match(/run: pnpm --filter @hv-pony-solver\/extension build$/gmu)?.length, 1)
  assert.doesNotMatch(extensionJob, /pnpm test:e2e:extension:(?:chromium|firefox):load-only/u)
  assert.match(extensionJob, /pnpm --filter @hv-pony-solver\/extension test:e2e:chromium:load-only/u)
  assert.match(extensionJob, /pnpm --filter @hv-pony-solver\/extension test:e2e:firefox:load-only/u)
  assert.match(extensionJob, /pnpm --filter @hv-pony-solver\/extension benchmark:ci/u)
})
