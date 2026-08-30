import assert from 'node:assert/strict'
import test from 'node:test'

import { assertCleanOrtSourceOutputs } from './assert-clean-ort-source.mjs'

test('accepts a clean checkout with initialized pinned submodules', () => {
  assert.doesNotThrow(() =>
    assertCleanOrtSourceOutputs('', ' 0123456789abcdef dependency/path\n abcdef0123456789 nested/path\n'),
  )
})

test('rejects tracked, untracked, and ignored source changes', () => {
  for (const status of [' M js/web/script/build.ts\n', '?? injected.js\n', '!! ignored-payload.js\n']) {
    assert.throws(() => assertCleanOrtSourceOutputs(status, ''), /not clean/)
  }
})

test('rejects uninitialized, drifted, and conflicted submodules', () => {
  for (const prefix of ['-', '+', 'U']) {
    assert.throws(
      () => assertCleanOrtSourceOutputs('', `${prefix}0123456789abcdef dependency/path\n`),
      /submodule state is not pinned and initialized/,
    )
  }
})
