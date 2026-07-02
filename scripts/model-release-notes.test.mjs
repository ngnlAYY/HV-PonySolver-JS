import assert from 'node:assert/strict'
import test from 'node:test'

import { createModelReleaseNotes } from './model-release-notes.mjs'

const manifest = {
  version: 'yolo26n-640-2026-05-14',
  byteLength: 9809075,
  sha256: '318e96a0c32202fea2f4c0aed6010f5ba4a13952f5206a9b1cddc9a4fcf1f070',
}

test('createModelReleaseNotes formats model version and integrity', () => {
  const notes = createModelReleaseNotes(manifest)

  assert.match(notes, /yolo26n-640-2026-05-14/)
  assert.match(notes, /9809075 bytes/)
  assert.match(notes, /318e96a0c32202fea2f4c0aed6010f5ba4a13952f5206a9b1cddc9a4fcf1f070/)
})

test('createModelReleaseNotes records release verification steps', () => {
  const notes = createModelReleaseNotes(manifest)

  assert.match(notes, /verify-model-integrity/)
  assert.match(notes, /R2 real object key/)
  assert.match(notes, /保留上一版 R2 object/)
})
