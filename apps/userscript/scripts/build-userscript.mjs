import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import {
  readFirstExistingOnnxRuntimeAssetStats,
  readOnnxRuntimeAssetsManifest,
  resolveInstalledOnnxRuntimeAssetPathCandidates,
  sha256Hex,
} from './onnx-runtime-assets.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const entryPoint = resolve(appDir, 'src/main.ts')
const workerEntryPoint = resolve(appDir, 'src/inference/onnx-worker-entry.ts')
const metadataPath = resolve(appDir, 'src/userscript/metadata.ts')

export const workerRuntimeSourcePlaceholder = '__HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE_PLACEHOLDER__'

export function parseMinifyFlag(args) {
  const minifyArg = args.findLast((arg) => arg === '--minify' || arg.startsWith('--minify='))
  return minifyArg === '--minify' || minifyArg === '--minify=true'
}

export function validateUserscriptMetadata(metadata) {
  const metadataLines = metadata.split('\n')
  if (metadataLines[0] !== '// ==UserScript==') {
    throw new Error('Userscript metadata must start with // ==UserScript==')
  }
  if (metadataLines[metadataLines.length - 1] !== '// ==/UserScript==') {
    throw new Error('Userscript metadata must end with // ==/UserScript==')
  }
}

export function createUserscriptOutput(metadata, bundledText) {
  return `${metadata}\n\n${bundledText}`
}

export function createMetafileJson(mainMetafile, workerMetafile) {
  return JSON.stringify({ main: mainMetafile, worker: workerMetafile }, null, 2)
}

export function createWorkerBuildOptions({ workerEntryPoint, shouldMinify, shouldWriteMetafile }) {
  return {
    entryPoints: [workerEntryPoint],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    legalComments: 'none',
    minify: shouldMinify,
    define: {
      __HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE__: JSON.stringify(workerRuntimeSourcePlaceholder),
    },
    metafile: shouldWriteMetafile,
  }
}

export function createMainBuildOptions({ entryPoint, shouldMinify, shouldWriteMetafile, onnxRuntimeSource, workerScriptText }) {
  return {
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    legalComments: 'none',
    logLevel: 'info',
    charset: 'utf8',
    minify: shouldMinify,
    metafile: shouldWriteMetafile,
    define: {
      __HV_PONY_SOLVER_ONNX_RUNTIME_SOURCE__: JSON.stringify(onnxRuntimeSource),
      __HV_PONY_SOLVER_WORKER_SCRIPT__: JSON.stringify(workerScriptText),
    },
  }
}

async function readUserscriptMetadata(metadataPath) {
  const metadataSource = await readFile(metadataPath, 'utf8')
  const metadataMatch = metadataSource.match(/export\s+const\s+USERSCRIPT_METADATA\s*=\s*`([\s\S]*?)`/)
  if (!metadataMatch) {
    throw new Error('Unable to read USERSCRIPT_METADATA template literal')
  }
  const metadata = metadataMatch[1]
  validateUserscriptMetadata(metadata)
  return metadata
}

async function buildWorkerScript({ workerEntryPoint, shouldMinify, shouldWriteMetafile }) {
  const result = await build(createWorkerBuildOptions({ workerEntryPoint, shouldMinify, shouldWriteMetafile }))
  const outputFile = result.outputFiles[0]
  if (!outputFile) {
    throw new Error('esbuild did not return a worker bundle')
  }
  return { text: outputFile.text, metafile: result.metafile }
}

async function readOnnxRuntimeSource({ runtimePath, manifest }) {
  const resolvedRuntimePath = runtimePath || await resolveOnnxRuntimePath(manifest)
  const { scriptAsset } = manifest
  if (basename(resolvedRuntimePath) !== scriptAsset.filename) {
    throw new Error(`ONNX runtime source must be named ${scriptAsset.filename}`)
  }

  const bytes = await readFile(resolvedRuntimePath)
  if (bytes.byteLength === 0 || bytes.byteLength > scriptAsset.maxByteLength) {
    throw new Error(`ONNX runtime source size must be between 1 and ${scriptAsset.maxByteLength} bytes`)
  }
  if (bytes.byteLength !== scriptAsset.byteLength) {
    throw new Error(`ONNX runtime source size must be ${scriptAsset.byteLength} bytes`)
  }
  if (sha256Hex(bytes) !== scriptAsset.sha256) {
    throw new Error('ONNX runtime source SHA-256 mismatch')
  }
  return bytes.toString('utf8')
}

async function resolveOnnxRuntimePath(manifest) {
  const assetPaths = resolveInstalledOnnxRuntimeAssetPathCandidates(manifest, resolve(appDir, '../..'))
  const { filePath } = await readFirstExistingOnnxRuntimeAssetStats(assetPaths)
  return filePath
}

async function buildUserscript({ args = process.argv.slice(2), env = process.env } = {}) {
  const shouldMinify = parseMinifyFlag(args)
  const outputPath = env.HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH || resolve(appDir, 'dist/hv-pony-solver.user.js')
  const metafilePath = env.HV_PONY_SOLVER_METAFILE_PATH
  const shouldWriteMetafile = Boolean(metafilePath)
  const onnxRuntimeManifest = await readOnnxRuntimeAssetsManifest()
  const onnxRuntimeSource = env.HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME === '1'
    ? await readOnnxRuntimeSource({
        runtimePath: env.HV_PONY_SOLVER_ONNX_RUNTIME_PATH,
        manifest: onnxRuntimeManifest,
      })
    : ''
  const workerBuild = await buildWorkerScript({ workerEntryPoint, shouldMinify, shouldWriteMetafile })
  const result = await build(createMainBuildOptions({
    entryPoint,
    shouldMinify,
    shouldWriteMetafile,
    onnxRuntimeSource,
    workerScriptText: workerBuild.text,
  }))

  const metadata = await readUserscriptMetadata(metadataPath)

  const outputFile = result.outputFiles[0]
  if (!outputFile) {
    throw new Error('esbuild did not return a bundle')
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, createUserscriptOutput(metadata, outputFile.text))
  if (metafilePath) {
    await mkdir(dirname(metafilePath), { recursive: true })
    await writeFile(metafilePath, createMetafileJson(result.metafile, workerBuild.metafile))
  }
}

function isDirectRun(moduleUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && moduleUrl === pathToFileURL(resolve(argvPath)).href
}

if (isDirectRun(import.meta.url)) {
  await buildUserscript()
}
