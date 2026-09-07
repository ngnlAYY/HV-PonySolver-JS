import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { URL } from 'node:url'

const repositoryRoot = new URL('../../', import.meta.url)

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

test('publishes the exact remote extension ZIPs already exercised by the shared E2E job', async () => {
  const workflow = await readFile(new URL('.github/workflows/verify-monorepo.yml', repositoryRoot), 'utf8')
  const extensionJob = workflow.match(/\n {2}extension-e2e:[\s\S]*?(?=\n {2}extension-remote-authenticated-e2e:)/u)?.[0]
  const releaseJob = workflow.match(/\n {2}extension-release:[\s\S]*$/u)?.[0]
  assert.ok(extensionJob)
  assert.ok(releaseJob)

  assert.match(
    extensionJob,
    /Transfer tested remote extension packages to Release job\n\s+if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.publish_extension_release \}\}/u,
  )
  assert.match(extensionJob, /name: hv-pony-solver-extension-remote-tested/u)
  assert.match(extensionJob, /apps\/extension\/dist\/\*\.zip/u)
  assert.match(extensionJob, /apps\/extension\/dist\/\*\.zip\.sha256/u)
  assert.match(extensionJob, /apps\/extension\/dist\/\*\.artifact\.json/u)
  assert.match(releaseJob, /name: hv-pony-solver-extension-remote-tested/u)
  assert.doesNotMatch(releaseJob, /pnpm --filter @hv-pony-solver\/extension build/u)
})

test('reruns canonical-model-only package tests after the canonical model download', async () => {
  const workflow = await readFile(new URL('.github/workflows/verify-monorepo.yml', repositoryRoot), 'utf8')
  const canonicalJob = workflow.match(
    /\n {2}extension-canonical-packaged-e2e:[\s\S]*?(?=\n {2}firefox-android-142-release-gate:)/u,
  )?.[0]
  assert.ok(canonicalJob)

  const downloadIndex = canonicalJob.indexOf('Download and verify canonical model')
  const testIndex = canonicalJob.indexOf('Run canonical-model-only package tests')
  assert.ok(downloadIndex >= 0)
  assert.ok(testIndex > downloadIndex)
  assert.match(canonicalJob, /--test-name-pattern=/u)
  assert.match(canonicalJob, /build-extension\.test\.mjs/u)
  assert.match(canonicalJob, /release-gate\.test\.mjs/u)
})
