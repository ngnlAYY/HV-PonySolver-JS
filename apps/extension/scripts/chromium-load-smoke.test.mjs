import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveRemoteSmokeMode } from './chromium-load-smoke.mjs'

test('remote load-only mode never requires or implies an authenticated Key', () => {
  assert.deepEqual(resolveRemoteSmokeMode(['--load-only'], {}), { mode: 'load-only' })
})

test('authenticated remote CI branch fails closed when KvKey is absent', () => {
  for (const environment of [{}, { KvKey: '' }, { KvKey: '   ' }]) {
    assert.throws(
      () => resolveRemoteSmokeMode(['--authenticated'], environment),
      /KvKey is required for the authenticated remote inference smoke/u,
    )
  }
  assert.deepEqual(resolveRemoteSmokeMode(['--authenticated'], { KvKey: ' test-key ' }), {
    mode: 'authenticated',
    key: 'test-key',
  })
})

test('remote smoke requires one explicit non-ambiguous mode', () => {
  for (const args of [[], ['--unknown'], ['--load-only', '--authenticated']]) {
    assert.throws(() => resolveRemoteSmokeMode(args, {}), /Usage:/u)
  }
})
