import assert from 'node:assert/strict'
import test from 'node:test'

import {
  IMAGE_SIZE_PATCH_SHA256,
  MALICIOUS_FIXTURE_NAMES,
  PATCHED_GHSA_IDS,
  PATCHED_IMAGE_SIZE_VERSION,
  createMaliciousFixture,
  createValidFixtures,
  execBoundedNode,
  verifyPatchedDependencies,
} from './verify-patched-dependencies.mjs'

test('audit gate names only the locally patched image-size advisories', () => {
  assert.deepEqual(PATCHED_GHSA_IDS, ['GHSA-w3rx-r6r6-pgpr', 'GHSA-5p2g-fcmc-qvqq'])
})

test('fixtures cover every guarded image-size parser', () => {
  assert.deepEqual(MALICIOUS_FIXTURE_NAMES, ['heif', 'icns', 'jxl'])
  for (const name of MALICIOUS_FIXTURE_NAMES) {
    assert.ok(createMaliciousFixture(name).length > 0)
  }
  assert.deepEqual(
    createValidFixtures().map((fixture) => fixture.name),
    MALICIOUS_FIXTURE_NAMES,
  )
})

test('bounded probes kill a child process that does not settle', { timeout: 2_000 }, async () => {
  await assert.rejects(
    execBoundedNode(['--eval', 'setInterval(() => {}, 1_000)'], 200),
    (error) => error?.killed === true && error?.signal === 'SIGKILL',
  )
})

test('installed web-ext chain uses the exact executable image-size patch', { timeout: 20_000 }, async () => {
  const result = await verifyPatchedDependencies()
  assert.equal(result.versions.webExt, '10.6.0')
  assert.equal(result.versions.addonsLinter, '10.10.0')
  assert.equal(result.versions.imageSize, PATCHED_IMAGE_SIZE_VERSION)
  assert.equal(result.patchSha256, IMAGE_SIZE_PATCH_SHA256)
  assert.deepEqual(
    result.probes.map((probe) => probe.fixture),
    MALICIOUS_FIXTURE_NAMES,
  )
})
