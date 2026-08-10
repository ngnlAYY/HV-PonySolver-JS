import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { build } from 'esbuild'

import {
  assetIntegrityMatches,
  readAssetStats,
  readOnnxRuntimeAssetsManifest,
  resolveRuntimeBundlePath,
} from './onnx-runtime-assets.mjs'

const appDir = resolve(import.meta.dirname, '..')
const repoRoot = resolve(appDir, '../..')
const entryPoint = resolve(appDir, 'src/main.ts')
const externalWorkerEntryPoint = resolve(appDir, 'src/inference/onnx-worker-external-entry.ts')
const bundledWorkerEntryPoint = resolve(appDir, 'src/inference/onnx-worker-bundled-entry.ts')
const metadataPath = resolve(appDir, 'src/userscript/metadata.ts')
const runtimeProfiles = new Set(['external', 'bundled'])

export function parseMinifyFlag(args) {
  let enabled = false
  for (const argument of args) {
    if (argument === '--minify' || argument === '--minify=true') enabled = true
    else if (argument.startsWith('--minify=')) enabled = false
  }
  return enabled
}

export function parseRuntimeProfile(args) {
  let profile = 'external'
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--runtime') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--runtime requires a value')
      profile = value
      index += 1
    } else if (argument.startsWith('--runtime=')) {
      profile = argument.slice('--runtime='.length)
    }
  }
  if (!runtimeProfiles.has(profile)) {
    throw new Error(`Unknown runtime profile: ${profile}; expected external or bundled`)
  }
  return profile
}

export function validateUserscriptMetadata(metadata) {
  if (!metadata.startsWith('// ==UserScript==')) throw new Error('Userscript metadata must start with // ==UserScript==')
  if (!metadata.endsWith('// ==/UserScript==')) throw new Error('Userscript metadata must end with // ==/UserScript==')
}

export function createUserscriptOutput(metadata, bundledText) {
  return `${metadata}\n\n${bundledText}`
}

export function createMetafileJson(main, worker) {
  return JSON.stringify({ main, worker }, null, 2)
}

export function createArtifactManifest({ outputFile, byteLength, sha256, minified, bundledRuntime, metafilePath }) {
  return {
    artifact: outputFile,
    byteLength,
    sha256,
    minified,
    bundledRuntime,
    ...(metafilePath ? { metafile: metafilePath } : {}),
  }
}

const commonBuildOptions = {
  bundle: true,
  write: false,
  target: 'es2022',
  platform: 'browser',
  legalComments: 'none',
}

export function createWorkerBuildOptions({
  workerEntryPoint,
  runtimeProfile,
  runtimeBundlePath,
  runtimeManifest,
  shouldMinify,
  shouldWriteMetafile,
}) {
  const options = {
    ...commonBuildOptions,
    entryPoints: [workerEntryPoint],
    format: 'iife',
    minify: shouldMinify,
    metafile: shouldWriteMetafile,
  }
  if (runtimeProfile === 'bundled') {
    if (!runtimeBundlePath) throw new Error('Bundled runtime profile requires a runtime bundle path')
    return {
      ...options,
      alias: { 'onnxruntime-web/wasm': runtimeBundlePath },
      define: {
        'import.meta.url': JSON.stringify(runtimeManifest.wasmAsset.url),
        __HV_PONY_SOLVER_BUNDLED_ORT_WASM_URL__: JSON.stringify(runtimeManifest.wasmAsset.url),
        __HV_PONY_SOLVER_BUNDLED_ORT_WASM_BYTE_LENGTH__: String(runtimeManifest.wasmAsset.byteLength),
        __HV_PONY_SOLVER_BUNDLED_ORT_WASM_SHA256__: JSON.stringify(runtimeManifest.wasmAsset.sha256),
        __HV_PONY_SOLVER_BUNDLED_ORT_WASM_MAX_BYTE_LENGTH__: String(runtimeManifest.wasmAsset.maxByteLength),
      },
    }
  }
  return {
    ...options,
    define: {
      __HV_PONY_SOLVER_EXTERNAL_ORT_SCRIPT_URL__: JSON.stringify(runtimeManifest.externalFullRuntime.scriptUrl),
      __HV_PONY_SOLVER_EXTERNAL_ORT_WASM_BASE_URL__: JSON.stringify(runtimeManifest.externalFullRuntime.wasmBaseUrl),
    },
  }
}

export function createMainBuildOptions({ entryPoint, shouldMinify, shouldWriteMetafile, workerScriptText }) {
  return {
    ...commonBuildOptions,
    entryPoints: [entryPoint],
    format: 'iife',
    minify: shouldMinify,
    metafile: shouldWriteMetafile,
    define: {
      __HV_PONY_SOLVER_WORKER_SCRIPT__: JSON.stringify(workerScriptText),
    },
  }
}

function outputText(result, label) {
  const output = result.outputFiles?.[0]
  if (!output) throw new Error(`esbuild did not return ${label} output`)
  return output.text
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function main() {
  const args = process.argv.slice(2)
  const shouldMinify = parseMinifyFlag(args)
  const runtimeProfile = parseRuntimeProfile(args)
  const outputPath = resolve(process.env.HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH || resolve(appDir, 'dist/hv-pony-solver.user.js'))
  const metafilePath = process.env.HV_PONY_SOLVER_METAFILE_PATH
  const artifactManifestPath = process.env.HV_PONY_SOLVER_ARTIFACT_MANIFEST_PATH
  const artifactSha256Path = process.env.HV_PONY_SOLVER_ARTIFACT_SHA256_PATH
  const shouldWriteMetafile = Boolean(metafilePath)
  const runtimeManifest = await readOnnxRuntimeAssetsManifest(repoRoot)
  let runtimeBundlePath
  if (runtimeProfile === 'bundled') {
    runtimeBundlePath = resolve(
      process.env.HV_PONY_SOLVER_ONNX_RUNTIME_BUNDLE_PATH || resolveRuntimeBundlePath(runtimeManifest, repoRoot),
    )
    const runtimeStats = await readAssetStats(runtimeBundlePath)
    if (!assetIntegrityMatches(runtimeStats, runtimeManifest.bundleAsset)) {
      throw new Error(
        `Custom ONNX Runtime bundle integrity mismatch: expected byteLength=${runtimeManifest.bundleAsset.byteLength} ` +
          `sha256=${runtimeManifest.bundleAsset.sha256}; actual byteLength=${runtimeStats.byteLength} sha256=${runtimeStats.sha256}`,
      )
    }
  }

  const workerResult = await build(
    createWorkerBuildOptions({
      workerEntryPoint: runtimeProfile === 'bundled' ? bundledWorkerEntryPoint : externalWorkerEntryPoint,
      runtimeProfile,
      runtimeBundlePath,
      runtimeManifest,
      shouldMinify,
      shouldWriteMetafile,
    }),
  )
  const workerScriptText = outputText(workerResult, 'worker')
  const mainResult = await build(
    createMainBuildOptions({ entryPoint, shouldMinify, shouldWriteMetafile, workerScriptText }),
  )
  const mainText = outputText(mainResult, 'main')
  const metadataModule = await readFile(metadataPath, 'utf8')
  const metadataMatch = metadataModule.match(/`([\s\S]*?)`/)
  if (!metadataMatch?.[1]) throw new Error('Unable to read userscript metadata')
  validateUserscriptMetadata(metadataMatch[1])
  const output = createUserscriptOutput(metadataMatch[1], mainText)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, output)

  if (metafilePath) {
    await mkdir(dirname(resolve(metafilePath)), { recursive: true })
    await writeFile(resolve(metafilePath), createMetafileJson(mainResult.metafile, workerResult.metafile))
  }
  const outputSha256 = sha256(output)
  if (artifactSha256Path) {
    await mkdir(dirname(resolve(artifactSha256Path)), { recursive: true })
    await writeFile(resolve(artifactSha256Path), `${outputSha256}\n`)
  }
  if (artifactManifestPath) {
    const manifest = createArtifactManifest({
      outputFile: relative(repoRoot, outputPath),
      byteLength: Buffer.byteLength(output),
      sha256: outputSha256,
      minified: shouldMinify,
      bundledRuntime: runtimeProfile === 'bundled',
      metafilePath: metafilePath ? relative(repoRoot, resolve(metafilePath)) : undefined,
    })
    await mkdir(dirname(resolve(artifactManifestPath)), { recursive: true })
    await writeFile(resolve(artifactManifestPath), `${JSON.stringify(manifest, null, 2)}\n`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  await main()
}
