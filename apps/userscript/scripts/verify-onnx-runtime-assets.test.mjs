import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { runCli } from './verify-onnx-runtime-assets.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../../..')

test('verifies actual bundle bytes and rejects same-length corruption without reporting success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hv-pony-runtime-verifier-'))
  const manifest = 'apps/userscript/src/inference/onnx-runtime-assets.ts'
  const bundle = 'apps/userscript/vendor/onnxruntime/ort.wasm.bundle.min.mjs'
  try {
    for (const relativePath of [manifest, bundle]) {
      await mkdir(dirname(join(root, relativePath)), { recursive: true })
      await cp(join(repositoryRoot, relativePath), join(root, relativePath))
    }
    const bytes = await readFile(join(root, bundle))
    const digest = createHash('sha256').update(bytes).digest('hex')
    let output = ''
    await runCli(root, {}, (chunk) => {
      output += chunk
    })
    assert.ok(output.includes(`byteLength=${bytes.length} sha256=${digest}`))

    bytes[0] ^= 1
    await writeFile(join(root, bundle), bytes)
    output = ''
    await assert.rejects(
      runCli(root, {}, (chunk) => {
        output += chunk
      }),
      /runtime bundle integrity mismatch/u,
    )
    assert.equal(output, '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
