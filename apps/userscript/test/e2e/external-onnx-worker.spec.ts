import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { build, type BuildOptions } from 'esbuild'

import { createWorkerBuildOptions } from '../../scripts/build-userscript.mjs'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(dirname, '../..')
const localPageUrl = 'http://localhost/external-onnx-worker'
const assetBaseUrl = 'https://pony-solver-assets-e2e.local/'

const classicRuntimeBytes = Buffer.from(`
self.ort = {
  env: { wasm: {} },
  InferenceSession: {
    async create(modelBuffer, options) {
      const wasm = self.ort.env.wasm;
      const jsep = await import(wasm.wasmPaths.mjs);
      if (jsep.fixtureMarker !== 'native-jsep-import') throw new Error('JSEP MJS import failed');
      if (!(wasm.wasmBinary instanceof ArrayBuffer) || wasm.wasmBinary.byteLength !== 8) {
        throw new Error('verified WASM was not injected');
      }
      if (modelBuffer.byteLength !== 3 || options.executionProviders[0] !== 'wasm') {
        throw new Error('unexpected session initialization');
      }
      return { async run() { return {}; }, async release() {} };
    }
  },
  Tensor: class Tensor {}
};
`)
const mjsBytes = Buffer.from("export const fixtureMarker = 'native-jsep-import'\n")
const wasmBytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const testRuntimeManifest = {
  externalFullRuntime: {
    scriptUrl: `${assetBaseUrl}ort.min.js`,
    wasmBaseUrl: assetBaseUrl,
    mjsUrl: `${assetBaseUrl}ort-wasm-simd-threaded.jsep.mjs`,
    mjsByteLength: mjsBytes.byteLength,
    mjsSha256: sha256(mjsBytes),
    mjsMaxByteLength: 256,
    wasmUrl: `${assetBaseUrl}ort-wasm-simd-threaded.jsep.wasm`,
    wasmByteLength: wasmBytes.byteLength,
    wasmSha256: sha256(wasmBytes),
    wasmMaxByteLength: 64,
    byteLength: classicRuntimeBytes.byteLength,
    sha256: sha256(classicRuntimeBytes),
    maxByteLength: 2_000,
  },
}

async function buildExternalWorker(): Promise<string> {
  // 该辅助函数是纯 JavaScript，TypeScript 会拓宽 esbuild 的字面量选项类型。
  const workerBuildOptions = createWorkerBuildOptions({
    workerEntryPoint: path.resolve(appRoot, 'src/inference/onnx-worker-external-entry.ts'),
    runtimeProfile: 'external',
    runtimeBundlePath: undefined,
    runtimeManifest: testRuntimeManifest,
    shouldMinify: false,
    shouldWriteMetafile: false,
  }) as unknown as BuildOptions
  const result = await build(workerBuildOptions)
  const workerText = result.outputFiles?.[0]?.text
  if (!workerText) throw new Error('Failed to build external ONNX worker fixture')
  return workerText
}

test('external Blob Worker initializes after a native JSEP MJS import', async ({ page }) => {
  const workerText = await buildExternalWorker()
  const requestedAssets: string[] = []
  const assets = new Map([
    [testRuntimeManifest.externalFullRuntime.scriptUrl, { bytes: classicRuntimeBytes, contentType: 'text/javascript' }],
    [testRuntimeManifest.externalFullRuntime.mjsUrl, { bytes: mjsBytes, contentType: 'text/javascript' }],
    [testRuntimeManifest.externalFullRuntime.wasmUrl, { bytes: wasmBytes, contentType: 'application/wasm' }],
  ])
  for (const [url, asset] of assets) {
    await page.route(url, async (route) => {
      requestedAssets.push(url)
      await route.fulfill({
        status: 200,
        contentType: asset.contentType,
        headers: {
          'access-control-allow-origin': '*',
          'content-length': String(asset.bytes.byteLength),
        },
        body: asset.bytes,
      })
    })
  }
  await page.route(localPageUrl, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><main>worker fixture</main>' })
  })
  await page.goto(localPageUrl)

  const result = await page.evaluate(async (script) => {
    const workerUrl = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }))
    const worker = new Worker(workerUrl)
    URL.revokeObjectURL(workerUrl)
    try {
      const message = await new Promise<Record<string, unknown>>((resolve, reject) => {
        worker.addEventListener('message', (event: MessageEvent<Record<string, unknown>>) => resolve(event.data), {
          once: true,
        })
        worker.addEventListener('error', (event) => reject(new Error(event.message)), { once: true })
        const modelBuffer = new Uint8Array([1, 2, 3]).buffer
        worker.postMessage({ type: 'init', requestId: 1, modelBuffer }, [modelBuffer])
      })
      if (message.type === 'error') throw new Error(String(message.message))
      return {
        type: message.type,
        requestId: message.requestId,
        modelByteLength: (message.modelBuffer as ArrayBuffer).byteLength,
      }
    } finally {
      worker.terminate()
    }
  }, workerText)

  expect(result).toEqual({ type: 'response', requestId: 1, modelByteLength: 3 })
  expect(requestedAssets).toEqual(expect.arrayContaining([...assets.keys()]))
  expect(requestedAssets).toHaveLength(3)
})
