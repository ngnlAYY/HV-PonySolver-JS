import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, '..')
const tmpRoot = resolve(appDir, '.tmp')
await mkdir(tmpRoot, { recursive: true })
// 每次调用只拥有自己的工作目录，并发成功或失败均不能清理其他运行。
const tmpDir = await mkdtemp(resolve(tmpRoot, 'benchmark-inference-'))
const entryPath = resolve(tmpDir, 'entry.ts')
const outputPath = resolve(tmpDir, 'entry.mjs')

const pixelChannels = 4
const rgbChannels = 3
const yoloRows = 256
const preprocessIterations = 100
const parserIterations = 1000
const sampleCount = 7

async function loadBenchmarkedFunctions() {
  await writeFile(
    entryPath,
    [
      "import { copyRgbaToChwFloat32, imagePreprocessConfig, parseYoloOutputTensor, yoloOutputConfig } from '@hv-pony-solver/browser-core'",
      'export { copyRgbaToChwFloat32, imagePreprocessConfig, parseYoloOutputTensor, yoloOutputConfig }',
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
  for (let index = 0; index < iterations; index += 1) {
    run()
  }
  const samples = []
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const startedAt = performance.now()
    for (let index = 0; index < iterations; index += 1) run()
    samples.push((performance.now() - startedAt) / iterations)
  }
  samples.sort((left, right) => left - right)
  const median = samples[Math.floor(samples.length / 2)]
  process.stdout.write(
    `${label}: ${median.toFixed(4)}ms/op (median of ${sampleCount} batches, ${iterations} ops/batch)\n`,
  )
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
  return { data: yolo, dims: [1, yoloRows, yoloOutputConfig.rowSize] }
}

try {
  const { copyRgbaToChwFloat32, imagePreprocessConfig, parseYoloOutputTensor, yoloOutputConfig } =
    await loadBenchmarkedFunctions()
  const { plane, rgba, chw } = createRgbaFixture(imagePreprocessConfig.imageSize)
  const yolo = createYoloFixture(yoloOutputConfig)

  time('copyRgbaToChwFloat32', preprocessIterations, () => copyRgbaToChwFloat32(rgba, chw, plane))
  time('parseYoloOutputTensor', parserIterations, () => parseYoloOutputTensor(yolo))
} finally {
  await rm(tmpDir, { recursive: true, force: true })
}
