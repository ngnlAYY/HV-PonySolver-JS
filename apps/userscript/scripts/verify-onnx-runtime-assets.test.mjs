import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

import { runCli } from './verify-onnx-runtime-assets.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../../..')

test('reports that optional runtime WASM verification was intentionally skipped', async () => {
  let output = ''

  await runCli(repositoryRoot, {}, (chunk) => {
    output += chunk
  })

  assert.match(output, /runtime WASM skipped/u)
})

test('package test and coverage commands execute the runtime asset verifier tests', async () => {
  const packageJson = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8'))

  assert.match(packageJson.scripts.test, /verify-onnx-runtime-assets\.test\.mjs/u)
  assert.match(packageJson.scripts['test:coverage'], /verify-onnx-runtime-assets\.test\.mjs/u)
  assert.match(packageJson.scripts['test:coverage'], /--test-coverage-lines=/u)
  assert.match(packageJson.scripts['test:coverage'], /--test-coverage-branches=/u)
  assert.match(packageJson.scripts['test:coverage'], /--test-coverage-functions=/u)
})
