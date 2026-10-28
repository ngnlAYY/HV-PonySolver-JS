import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { buildMinimalOrtGlue } from './build-minimal-ort-glue.mjs'

async function fixture(t, { entry, wasm } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ort-glue-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'js')
  await mkdir(join(source, 'web/lib'), { recursive: true })
  await mkdir(join(source, 'common/lib'), { recursive: true })
  await writeFile(join(source, 'web/package.json'), JSON.stringify({ version: '1.27.0' }))
  await writeFile(join(source, 'common/lib/index.ts'), 'export function increment(value: number) { return value + 7 }')
  const entryPath = join(source, 'web/lib/index.ts')
  await writeFile(
    entryPath,
    entry ??
      `import createModule from '../dist/ort-wasm-simd-threaded.mjs'
       import { increment } from 'onnxruntime-common'
       export async function run() { return increment((await createModule()).answer) }`,
  )
  const wasmPath = join(root, 'ort-wasm-simd.mjs')
  await writeFile(
    wasmPath,
    wasm ??
      `export default async function () {
         if (typeof process !== 'undefined') await import('node:fs');
         if (globalThis.process) await import('worker_threads');
         return { answer: 35 };
       }`,
  )
  const output = join(root, 'output')
  return { source, wasmPath, output, entryPath }
}

test('bundles fixed common source and strips Node-only WASM branches without installed upstream dependencies', async (t) => {
  const { source, wasmPath, output, entryPath } = await fixture(t)
  const originalEntry = await readFile(entryPath, 'utf8')
  const path = await buildMinimalOrtGlue(source, wasmPath, output)
  const generated = await import(pathToFileURL(path).href)
  assert.equal(await generated.run(), 42)
  const text = await readFile(path, 'utf8')
  assert.match(text, /Copyright \(c\) Microsoft Corporation/u)
  assert.match(text, /Licensed under the MIT License/u)
  const sourceMap = JSON.parse(await readFile(`${path}.map`, 'utf8'))
  assert.equal(sourceMap.sources.length, sourceMap.sourcesContent.length)
  assert.ok(sourceMap.sourcesContent.includes(originalEntry))
  assert.equal(await readFile(entryPath, 'utf8'), originalEntry)
  await assert.rejects(access(join(source, 'node_modules')), { code: 'ENOENT' })
})

test('disables the fixed upstream module fallback before generating source maps', async (t) => {
  const { source, wasmPath, output } = await fixture(t, {
    entry: "export { dynamicImportDefault as load } from './wasm/wasm-utils-import'",
  })
  await mkdir(join(source, 'web/lib/wasm'))
  await writeFile(
    join(source, 'web/lib/wasm/wasm-utils-import.ts'),
    `export const dynamicImportDefault = async <T>(url: string): Promise<T> =>
       (await import(/* webpackIgnore: true */ /* @vite-ignore */ url)).default;`,
  )
  const path = await buildMinimalOrtGlue(source, wasmPath, output)
  const generated = await import(pathToFileURL(path).href)
  await assert.rejects(generated.load('data:text/javascript,export default 42'), /runtime modules are disabled/)
})

test('preserves browser-guarded Node fallback requires without executing them in the browser branch', async (t) => {
  const { source, wasmPath, output } = await fixture(t, {
    entry: `export function run() {
      return typeof navigator === 'undefined'
        ? [require('node:fs/promises'), require('node:fs'), require('node:os')]
        : 42
    }`,
  })
  const path = await buildMinimalOrtGlue(source, wasmPath, output)
  const generated = await import(pathToFileURL(path).href)
  assert.equal(await generated.run(), 42)
  const text = await readFile(path, 'utf8')
  for (const specifier of ['node:fs/promises', 'node:fs', 'node:os']) assert.ok(text.includes(specifier))
})

test('rejects new imports and unresolved build flags before writing any output', async (t) => {
  for (const entry of [
    'export const load = (url: string) => import(url)',
    "export { answer } from 'unexpected-package'",
    "export const load = () => require('node:child_process')",
    "export { cpus } from 'node:os'",
    "export const load = () => import('node:fs')",
    'export const enabled = BUILD_DEFS.NEW_FEATURE',
  ]) {
    const { source, wasmPath, output } = await fixture(t, { entry })
    await assert.rejects(buildMinimalOrtGlue(source, wasmPath, output), /external module import|unresolved build/)
    await assert.rejects(access(output), { code: 'ENOENT' })
  }
})

test('rejects an unexpected WASM variant rather than substituting the minimal binary', async (t) => {
  const { source, wasmPath, output } = await fixture(t, {
    entry: "export { default } from '../dist/ort-wasm-simd-threaded.jsep.mjs'",
  })
  await assert.rejects(buildMinimalOrtGlue(source, wasmPath, output), /Unexpected WASM module variant/)
  await assert.rejects(access(output), { code: 'ENOENT' })
})

test('rejects ambiguous Emscripten Worker transformations without publishing output', async (t) => {
  const { source, wasmPath, output } = await fixture(t, {
    wasm: `new Worker(new URL(import.meta.url), {}); new Worker(new URL(import.meta.url), {});`,
  })
  await assert.rejects(buildMinimalOrtGlue(source, wasmPath, output), /Worker constructors/)
  await assert.rejects(access(output), { code: 'ENOENT' })
})
