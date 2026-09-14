// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { ORT_RUNTIME_WASM_FILENAME } from '@hv-pony-solver/shared/ort-runtime'

import { loadPackagedRuntimeWasm } from '../../src/host/packaged-wasm'

afterEach(() => vi.unstubAllGlobals())

it.each(['chrome-extension:', 'moz-extension:'])('loads verified WASM from the package in %s', async (scheme) => {
  vi.stubGlobal('location', { href: `${scheme}//extension-id/runtime/inference-worker.js` })
  const bytes = new Uint8Array(
    await readFile(new URL(`../../../../other/${ORT_RUNTIME_WASM_FILENAME}`, import.meta.url)),
  )
  const fetchImpl = vi.fn(async () => new Response(bytes))

  const result = await loadPackagedRuntimeWasm(fetchImpl)

  expect(result.byteLength).toBe(bytes.byteLength)
  expect(fetchImpl).toHaveBeenCalledWith(`${scheme}//extension-id/runtime/${ORT_RUNTIME_WASM_FILENAME}`, {
    cache: 'force-cache',
    redirect: 'error',
  })
})
