import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const entryPoint = resolve(appDir, 'src/main.ts')
const workerEntryPoint = resolve(appDir, 'src/inference/onnx-worker-entry.ts')
const metadataPath = resolve(appDir, 'src/userscript/metadata.ts')
const MAX_ONNX_RUNTIME_BYTES = 2 * 1024 * 1024
const defaultOnnxRuntimeByteLength = 360388
const defaultOnnxRuntimeSha256 = 'ba5e52f4a87f823a700fa5eb916fd5946b970999e8e0518334b116f7b03bd53d'

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

async function readOnnxRuntimeSource({ runtimePath, expectedByteLength, expectedSha256 }) {
  const resolvedRuntimePath = runtimePath || resolveOnnxRuntimePath()
  if (basename(resolvedRuntimePath) !== 'ort.min.js') {
    throw new Error('ONNX runtime source must be named ort.min.js')
  }
  const stats = await stat(resolvedRuntimePath)
  if (stats.size === 0 || stats.size > MAX_ONNX_RUNTIME_BYTES) {
    throw new Error(`ONNX runtime source size must be between 1 and ${MAX_ONNX_RUNTIME_BYTES} bytes`)
  }
  if (stats.size !== expectedByteLength) {
    throw new Error(`ONNX runtime source size must be ${expectedByteLength} bytes`)
  }
  const source = await readFile(resolvedRuntimePath, 'utf8')
  const sha256 = createHash('sha256').update(source).digest('hex')
  if (sha256 !== expectedSha256) {
    throw new Error('ONNX runtime source SHA-256 mismatch')
  }
  return source
}

function resolveOnnxRuntimePath() {
  const require = createRequire(import.meta.url)
  const entryPath = require.resolve('onnxruntime-web')
  return resolve(dirname(entryPath), 'ort.min.js')
}

async function buildUserscript({ args = process.argv.slice(2), env = process.env } = {}) {
  const shouldMinify = parseMinifyFlag(args)
  const outputPath = env.HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH || resolve(appDir, 'dist/hv-pony-solver.user.js')
  const metafilePath = env.HV_PONY_SOLVER_METAFILE_PATH
  const shouldWriteMetafile = Boolean(metafilePath)
  const onnxRuntimeSource = env.HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME === '1'
    ? await readOnnxRuntimeSource({
        runtimePath: env.HV_PONY_SOLVER_ONNX_RUNTIME_PATH,
        expectedByteLength: Number(env.HV_PONY_SOLVER_ONNX_RUNTIME_BYTE_LENGTH || defaultOnnxRuntimeByteLength),
        expectedSha256: env.HV_PONY_SOLVER_ONNX_RUNTIME_SHA256 || defaultOnnxRuntimeSha256,
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
