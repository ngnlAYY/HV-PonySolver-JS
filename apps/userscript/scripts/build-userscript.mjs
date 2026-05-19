import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const entryPoint = resolve(appDir, 'src/main.ts')
const outputPath = process.env.HV_PONY_SOLVER_USERSCRIPT_OUTPUT_PATH || resolve(appDir, 'dist/hv-pony-solver.user.js')
const metadataPath = resolve(appDir, 'src/userscript/metadata.ts')
const MAX_ONNX_RUNTIME_BYTES = 2 * 1024 * 1024
const shouldBundleOnnxRuntime = process.env.HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME === '1'
const onnxRuntimeSource = shouldBundleOnnxRuntime ? await readOnnxRuntimeSource() : ''

const result = await build({
  entryPoints: [entryPoint],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  legalComments: 'none',
  logLevel: 'info',
  define: {
    __HV_PONY_SOLVER_ONNX_RUNTIME_SOURCE__: JSON.stringify(onnxRuntimeSource),
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

async function readOnnxRuntimeSource() {
  const runtimePath = process.env.HV_PONY_SOLVER_ONNX_RUNTIME_PATH || resolveOnnxRuntimePath()
  if (basename(runtimePath) !== 'ort.min.js') {
    throw new Error('ONNX runtime source must be named ort.min.js')
  }
  const stats = await stat(runtimePath)
  if (stats.size === 0 || stats.size > MAX_ONNX_RUNTIME_BYTES) {
    throw new Error(`ONNX runtime source size must be between 1 and ${MAX_ONNX_RUNTIME_BYTES} bytes`)
  }
  return readFile(runtimePath, 'utf8')
}

function resolveOnnxRuntimePath() {
  const require = createRequire(import.meta.url)
  const entryPath = require.resolve('onnxruntime-web')
  return resolve(dirname(entryPath), 'ort.min.js')
}
