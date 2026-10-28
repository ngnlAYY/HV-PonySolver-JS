// The WASM transformation and bundle options follow the pinned ONNX Runtime build.ts.
// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT License.
import { build } from 'esbuild'
import { minify } from 'terser'
import ts from 'typescript'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { isDirectRun } from '../lib/direct-run.mjs'

const bundleFilename = 'ort.wasm.bundle.min.mjs'
// The pinned ORT source retains these Node fallbacks behind isNode/navigator
// branches. They are require calls, never browser module imports.
const nodeFallbackRequires = new Set(['node:fs/promises', 'node:fs', 'node:os'])

function assertSelfContained(source) {
  const ast = ts.createSourceFile(bundleFilename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (ast.parseDiagnostics.length > 0) throw new Error('Generated ORT glue has invalid syntax')
  function visit(node) {
    if (
      ts.isImportDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      throw new Error('Generated ORT glue contains an external module import')
    }
    if (ts.isIdentifier(node) && node.text === 'BUILD_DEFS') {
      throw new Error('Generated ORT glue contains unresolved build definitions')
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
}

function disableDynamicRuntimeImport(source) {
  const ast = ts.createSourceFile('wasm-utils-import.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let fallback
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'dynamicImportDefault') {
      const arrow = node.initializer
      const body = arrow && ts.isArrowFunction(arrow) ? arrow.body : undefined
      const awaited =
        body && ts.isPropertyAccessExpression(body) && body.name.text === 'default' ? body.expression : undefined
      const expression = awaited && ts.isParenthesizedExpression(awaited) ? awaited.expression : undefined
      const call = expression && ts.isAwaitExpression(expression) ? expression.expression : undefined
      if (
        fallback ||
        !call ||
        !ts.isCallExpression(call) ||
        call.expression.kind !== ts.SyntaxKind.ImportKeyword ||
        call.arguments.length !== 1 ||
        !ts.isIdentifier(call.arguments[0]) ||
        call.arguments[0].text !== 'url' ||
        arrow.parameters.length !== 1 ||
        !ts.isIdentifier(arrow.parameters[0].name) ||
        arrow.parameters[0].name.text !== 'url'
      ) {
        throw new Error('Unexpected ONNX Runtime dynamic import fallback')
      }
      fallback = call
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!fallback) throw new Error('Missing ONNX Runtime dynamic import fallback')
  // Match the extension's existing refusal of external runtime modules, before
  // bundling so source maps describe the transformed source without later edits.
  return (
    source.slice(0, fallback.getStart(ast)) +
    'Promise.reject(new Error("Dynamic ONNX runtime modules are disabled in the minimal build"))' +
    source.slice(fallback.end)
  )
}

export async function buildMinimalOrtGlue(jsSourceRoot, wasmModulePath, outputDirectory) {
  const sourceRoot = resolve(jsSourceRoot)
  const wasmPath = resolve(wasmModulePath)
  const outputPath = join(resolve(outputDirectory), bundleFilename)
  const { version } = JSON.parse(await readFile(join(sourceRoot, 'web/package.json'), 'utf8'))
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error('Invalid ONNX Runtime source version')
  }
  let wasmSource = await readFile(wasmPath, 'utf8')
  const workerPattern = /new Worker\(new URL\(import\.meta\.url\),/gu
  if ([...wasmSource.matchAll(workerPattern)].length > 1) {
    throw new Error('Unexpected number of WASM module Worker constructors')
  }
  // Zero constructors is expected for the single-thread build. Preserve upstream's
  // file-URL workaround if Emscripten emits the otherwise unused worker branch.
  wasmSource = wasmSource.replace(
    workerPattern,
    `new Worker((() => {
      const URL2 = URL;
      return import.meta.url > 'file:' && import.meta.url < 'file;'
        ? new URL2(BUILD_DEFS.BUNDLE_FILENAME, import.meta.url)
        : new URL(import.meta.url);
    })(),`,
  )
  const wasm = await minify(wasmSource, {
    module: true,
    compress: { passes: 2, global_defs: { process: undefined, 'globalThis.process': undefined } },
  })
  if (typeof wasm.code !== 'string' || wasm.code.length === 0) throw new Error('Empty WASM module glue')
  const result = await build({
    absWorkingDir: sourceRoot,
    entryPoints: ['web/lib/index.ts'],
    outfile: outputPath,
    bundle: true,
    banner: {
      js: `/*!\n * ONNX Runtime Web v${version}\n * Copyright (c) Microsoft Corporation. All rights reserved.\n * Licensed under the MIT License.\n */`,
    },
    platform: 'browser',
    format: 'esm',
    globalName: 'ort',
    alias: { 'onnxruntime-common': join(sourceRoot, 'common/lib/index.ts') },
    plugins: [
      {
        name: 'minimal-wasm-module',
        setup(context) {
          context.onLoad({ filter: /wasm-utils-import\.ts$/ }, async (args) => {
            if (args.path !== join(sourceRoot, 'web/lib/wasm/wasm-utils-import.ts')) return undefined
            return { contents: disableDynamicRuntimeImport(await readFile(args.path, 'utf8')), loader: 'ts' }
          })
          context.onResolve({ filter: /ort-.*wasm.*\.mjs$/ }, (args) => {
            if (basename(args.path) !== 'ort-wasm-simd-threaded.mjs') {
              throw new Error('Unexpected WASM module variant in minimal ORT build')
            }
            return { path: wasmPath, namespace: 'minimal-wasm-module' }
          })
          context.onLoad({ filter: /.*/, namespace: 'minimal-wasm-module' }, () => ({
            contents: wasm.code,
            loader: 'js',
          }))
        },
      },
    ],
    external: ['node:fs/promises', 'node:fs', 'node:os', 'module', 'worker_threads'],
    packages: 'external',
    define: {
      'BUILD_DEFS.DISABLE_WEBGL': 'true',
      'BUILD_DEFS.DISABLE_JSEP': 'true',
      'BUILD_DEFS.DISABLE_WASM': 'false',
      'BUILD_DEFS.DISABLE_WASM_PROXY': 'true',
      'BUILD_DEFS.ENABLE_JSPI': 'false',
      'BUILD_DEFS.ENABLE_BUNDLE_WASM_JS': 'true',
      'BUILD_DEFS.DISABLE_WEBGPU': 'true',
      'BUILD_DEFS.DISABLE_WEBNN': 'true',
      'BUILD_DEFS.IS_ESM': 'true',
      'BUILD_DEFS.ESM_IMPORT_META_URL': 'import.meta.url',
      'BUILD_DEFS.BUNDLE_FILENAME': JSON.stringify(bundleFilename),
      process: 'undefined',
      'globalThis.process': 'undefined',
    },
    sourcemap: 'linked',
    minify: true,
    write: false,
    metafile: true,
  })
  if (
    Object.values(result.metafile.outputs).some((output) =>
      output.imports.some((entry) => entry.kind !== 'require-call' || !nodeFallbackRequires.has(entry.path)),
    )
  ) {
    throw new Error('Generated ORT glue contains an external module import')
  }
  const bundle = result.outputFiles.find((file) => file.path === outputPath)
  if (!bundle) throw new Error('Missing generated ORT glue')
  // No ES module imports remain, so upstream's import-comment/source-map rewrite
  // is unnecessary. The exact Node fallback requires above retain their guards.
  assertSelfContained(bundle.text)
  await mkdir(dirname(outputPath), { recursive: true })
  await Promise.all(result.outputFiles.map((file) => writeFile(file.path, file.contents)))
  return outputPath
}

if (isDirectRun(import.meta.url)) {
  if (process.argv.length !== 5) {
    throw new Error('Usage: build-minimal-ort-glue.mjs <js-source-root> <wasm-module> <output-directory>')
  }
  await buildMinimalOrtGlue(...process.argv.slice(2))
}
