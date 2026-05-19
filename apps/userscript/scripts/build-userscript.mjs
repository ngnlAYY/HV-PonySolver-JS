import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const entryPoint = resolve(appDir, 'src/main.ts')
const workerEntryPoint = resolve(appDir, 'src/inference/onnx-worker-entry.ts')
const outputPath = process.env.HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH || resolve(appDir, 'dist/hv-pony-solver.user.js')
const metadataPath = resolve(appDir, 'src/userscript/metadata.ts')
const shouldMinify = parseMinifyFlag(process.argv.slice(2))
const metafilePath = process.env.HV_PONY_SOLVER_METAFILE_PATH
const MAX_ONNX_RUNTIME_BYTES = 2 * 1024 * 1024
const expectedOnnxRuntimeByteLength = Number(process.env.HV_PONY_SOLVER_ONNX_RUNTIME_BYTE_LENGTH || 360388)
const expectedOnnxRuntimeSha256 = process.env.HV_PONY_SOLVER_ONNX_RUNTIME_SHA256 || 'ba5e52f4a87f823a700fa5eb916fd5946b970999e8e0518334b116f7b03bd53d'
const shouldBundleOnnxRuntime = process.env.HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME === '1'
const workerRuntimeSourcePlaceholder = '__HV_PONY_SOLVER_WORKER_RUNTIME_SOURCE_PLACEHOLDER__'
const onnxRuntimeSource = shouldBundleOnnxRuntime ? await readOnnxRuntimeSource() : ''
const workerBuild = await buildWorkerScript()

const result = await build({
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
  metafile: Boolean(metafilePath),
  define: {
    __HV_PONY_SOLVER_ONNX_RUNTIME_SOURCE__: JSON.stringify(onnxRuntimeSource),
    __HV_PONY_SOLVER_WORKER_SCRIPT__: JSON.stringify(workerBuild.text),
  },
})

const metadataSource = await readFile(metadataPath, 'utf8')
const metadataMatch = metadataSource.match(/export\s+const\s+USERSCRIPT_METADATA\s*=\s*`([\s\S]*?)`/)
if (!metadataMatch) {
  throw new Error('Unable to read USERSCRIPT_METADATA template literal')
}

const metadata = metadataMatch[1]
const metadataLines = metadata.split('\n')
if (metadataLines[0] !== '// ==UserScript==') {
  throw new Error('Userscript metadata must start with // ==UserScript==')
}
if (metadataLines[metadataLines.length - 1] !== '// ==/UserScript==') {
  throw new Error('Userscript metadata must end with // ==/UserScript==')
}

const outputFile = result.outputFiles[0]
if (!outputFile) {
  throw new Error('esbuild did not return a bundle')
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${metadata}\n\n${outputFile.text}`)
if (metafilePath) {
  await mkdir(dirname(metafilePath), { recursive: true })
  await writeFile(metafilePath, JSON.stringify({ main: result.metafile, worker: workerBuild.metafile }, null, 2))
}

async function buildWorkerScript() {
  const result = await build({
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
    metafile: Boolean(metafilePath),
  })
  const outputFile = result.outputFiles[0]
  if (!outputFile) {
    throw new Error('esbuild did not return a worker bundle')
  }
  return { text: outputFile.text, metafile: result.metafile }
}

function parseMinifyFlag(args) {
  const minifyArg = args.findLast((arg) => arg === '--minify' || arg.startsWith('--minify='))
  return minifyArg === '--minify' || minifyArg === '--minify=true'
}

async function readOnnxRuntimeSource() {
  const runtimePath = process.env.HV_PONY_SOLVER_ONNX_RUNTIME_PATH || resolveOnnxRuntimePath()
  if (basename(runtimePath) !== 'ort.min.js') {
    throw new Error('ONNX runtime source must be named ort.min.js')
  }
  const stats = await stat(runtimePath)
  if (stats.size === 0 || stats.size > MAX_ONNX_RUNTIME_BYTES) {
    throw new Error(`ONNX runtime source size must be between 1 and ${MAX_ONNX_RUNTIME_BYTES} bytes`)
  }
  if (stats.size !== expectedOnnxRuntimeByteLength) {
    throw new Error(`ONNX runtime source size must be ${expectedOnnxRuntimeByteLength} bytes`)
  }
  const source = await readFile(runtimePath, 'utf8')
  const sha256 = createHash('sha256').update(source).digest('hex')
  if (sha256 !== expectedOnnxRuntimeSha256) {
    throw new Error('ONNX runtime source SHA-256 mismatch')
  }
  return source
}

function resolveOnnxRuntimePath() {
  const require = createRequire(import.meta.url)
  const entryPath = require.resolve('onnxruntime-web')
  return resolve(dirname(entryPath), 'ort.min.js')
}
