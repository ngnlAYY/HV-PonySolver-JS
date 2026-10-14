// @vitest-environment node

import { afterEach, expect, it, vi } from 'vitest'
import { ORT_RUNTIME_WASM_FILENAME } from '@hv-pony-solver/shared/ort-runtime'

import { loadPackagedRuntimeWasm } from '../../src/host/packaged-wasm'

const fixtureBytes = vi.hoisted(() => Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]))

// Full tracked-asset identity belongs to build audits; both URL adapters still run the real integrity loader.
vi.mock('@hv-pony-solver/shared/ort-runtime', async () => {
  const { createHash } = await import('node:crypto')
  const sha256 = createHash('sha256').update(fixtureBytes).digest('hex')
  return {
    ORT_RUNTIME_WASM_SHA256: sha256,
    ORT_RUNTIME_WASM_FILENAME: `ort-wasm-simd-${sha256}.wasm`,
    ORT_RUNTIME_WASM_INTEGRITY: { byteLength: fixtureBytes.byteLength, sha256 },
  }
})

afterEach(() => vi.unstubAllGlobals())

it.each(['chrome-extension:', 'moz-extension:'])('loads verified WASM from the package in %s', async (scheme) => {
  vi.stubGlobal('location', { href: `${scheme}//extension-id/runtime/inference-worker.js` })
  const fetchImpl = vi.fn(async () => new Response(fixtureBytes))

  const result = await loadPackagedRuntimeWasm(fetchImpl)

  expect(new Uint8Array(result)).toEqual(fixtureBytes)
  expect(fetchImpl).toHaveBeenCalledWith(`${scheme}//extension-id/runtime/${ORT_RUNTIME_WASM_FILENAME}`, {
    cache: 'force-cache',
    redirect: 'error',
  })
})
