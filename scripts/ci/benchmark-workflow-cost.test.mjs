import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { URL } from 'node:url'

const repositoryRoot = new URL('../../', import.meta.url)

test('publishes the exact remote extension ZIPs already exercised by the shared E2E job', async () => {
  const workflow = await readFile(new URL('.github/workflows/verify-monorepo.yml', repositoryRoot), 'utf8')
  const extensionJob = workflow.match(/\n {2}extension-e2e:[\s\S]*?(?=\n {2}extension-remote-authenticated-e2e:)/u)?.[0]
  const releaseJob = workflow.match(/\n {2}extension-release:[\s\S]*$/u)?.[0]
  assert.ok(extensionJob)
  assert.ok(releaseJob)

  assert.match(
    extensionJob,
    /Transfer tested remote extension packages to Release job\n\s+if: \$\{\{ github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && inputs\.publish_extension_release &&/u,
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
    /\n {2}extension-canonical-packaged-e2e:[\s\S]*?(?=\n {2}userscript-artifact:)/u,
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
