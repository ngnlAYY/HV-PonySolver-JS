import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const tmpDir = resolve(appDir, '.tmp/benchmark-inference')
const entryPath = resolve(tmpDir, 'entry.ts')
const outputPath = resolve(tmpDir, 'entry.mjs')

const pixelChannels = 4
const rgbChannels = 3
const yoloRows = 256
const preprocessIterations = 20
const parserIterations = 1000

async function loadBenchmarkedFunctions() {
  await mkdir(tmpDir, { recursive: true })
  await writeFile(
    entryPath,
    [
      "import { copyRgbaToChwFloat32 } from '../../src/inference/image-preprocess'",
      "import { imagePreprocessConfig, yoloOutputConfig } from '../../src/inference/inference-config'",
      "import { parseYoloOutput } from '../../src/inference/yolo-output-parser'",
      'export { copyRgbaToChwFloat32, imagePreprocessConfig, parseYoloOutput, yoloOutputConfig }',
      '',
    ].join('\n'),
  )
  await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: true,
    outfile: outputPath,
    logLevel: 'silent',
  })
  return import(pathToFileURL(outputPath).href)
}

function time(label, iterations, run) {
  const startedAt = performance.now()
  for (let index = 0; index < iterations; index += 1) {
    run()
  }
  const elapsedMs = performance.now() - startedAt
  process.stdout.write(`${label}: ${(elapsedMs / iterations).toFixed(4)}ms/op\n`)
}

function createRgbaFixture(imageSize) {
  const plane = imageSize * imageSize
  const rgba = new Uint8ClampedArray(plane * pixelChannels)
  for (let index = 0; index < rgba.length; index += pixelChannels) {
    rgba[index] = 128
    rgba[index + 1] = 64
    rgba[index + 2] = 32
    rgba[index + 3] = 255
  }
  return { plane, rgba, chw: new Float32Array(plane * rgbChannels) }
}

function createYoloFixture(yoloOutputConfig) {
  const yolo = new Float32Array(yoloRows * yoloOutputConfig.rowSize)
  for (let row = 0; row < yoloRows; row += 1) {
    const base = row * yoloOutputConfig.rowSize
    yolo[base + yoloOutputConfig.confidenceIndex] = (row % 100) / 100
    yolo[base + yoloOutputConfig.classIndex] = row % 6
  }
  return yolo
}

try {
  const { copyRgbaToChwFloat32, imagePreprocessConfig, parseYoloOutput, yoloOutputConfig } =
    await loadBenchmarkedFunctions()
  const { plane, rgba, chw } = createRgbaFixture(imagePreprocessConfig.imageSize)
  const yolo = createYoloFixture(yoloOutputConfig)

  time('copyRgbaToChwFloat32', preprocessIterations, () => copyRgbaToChwFloat32(rgba, chw, plane))
  time('parseYoloOutput', parserIterations, () => parseYoloOutput(yolo))
} finally {
  await rm(tmpDir, { recursive: true, force: true })
}
