// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import { build } from 'esbuild'

import { createOnnxWorkerScript } from '../../src/inference/onnx-worker-script'

const testDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(testDir, '../..')
const workerEntryPoint = resolve(appDir, 'src/inference/onnx-worker-entry.ts')
const workerScriptGlobal = '__HV_PONY_SOLVER_TEST_WORKER_SCRIPT__'

describe('ONNX worker bundle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds from the TypeScript worker entry', async () => {
    const script = await buildWorkerScript()

    expect(script).toContain('importScripts')
    expect(script).toContain('createImageBitmap')
    expect(script).toContain('OffscreenCanvas')
    expect(script).toMatch(/onnxruntime-web (?:加载失败|\\u52A0\\u8F7D\\u5931\\u8D25)/)
    expect(script).not.toContain('new Blob([imageBuffer])')
  })

  it('creates parseable worker scripts without bundled runtime', async () => {
    const script = await buildWorkerScript()
    vi.stubGlobal(workerScriptGlobal, script)

    expect(() => new Script(createOnnxWorkerScript())).not.toThrow()
  })

  it('creates parseable worker scripts with bundled runtime', async () => {
    const script = await buildWorkerScript()
    vi.stubGlobal(workerScriptGlobal, script)

    expect(() => new Script(createOnnxWorkerScript('self.ort = { marker: 1 };'))).not.toThrow()
  })

  it.each(['$&', '$$', '$1', "$'", '$`'])('preserves bundled runtime replacement token %s as source text', (token) => {
    vi.stubGlobal(workerScriptGlobal, 'const runtimeSource = "__HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE_PLACEHOLDER__";')

    expect(createOnnxWorkerScript(`self.ort = { marker: '${token}' };`))
      .toBe(`const runtimeSource = "self.ort = { marker: '${token}' };";`)
  })

  it('uses the shared TypeScript YOLO parser', async () => {
    const script = await buildWorkerScript()
    const parserSource = await readFile(resolve(appDir, 'src/inference/yolo-output-parser.ts'), 'utf8')

    expect(script).toContain('result')
    expect(script).toContain('Math.round')
    expect(parserSource).toContain('export function parseYoloOutput')
  })
})

async function buildWorkerScript(): Promise<string> {
  const result = await build({
    entryPoints: [workerEntryPoint],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    legalComments: 'none',
    minify: true,
    define: {
      __HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE__: '"__HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE_PLACEHOLDER__"',
    },
  })
  const outputFile = result.outputFiles[0]
  if (!outputFile) {
    throw new Error('esbuild did not return a worker bundle')
  }
  return outputFile.text
}
