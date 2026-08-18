import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TextDecoder, isDeepStrictEqual } from 'node:util'
import { chromium } from '@playwright/test'
import { unzipSync } from 'fflate'

import {
  benchmarkSchemaVersion,
  buildScenarioMatrix,
  renderBenchmarkCsv,
  requiredBenchmarkDefaults,
  summarizeMeasuredSamples,
  validateBenchmarkConfig,
  validateBenchmarkResult,
} from './benchmark-contract.mjs'
import { assertSupportedBrowserVersion } from './browser-support.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDirectory, '..')
const repositoryRoot = path.resolve(extensionRoot, '..', '..')
const defaultOutputDirectory = path.join(extensionRoot, '.tmp', 'benchmark')
const defaultArtifactRoot = path.join(extensionRoot, 'dist')
const transportWorkloadContract =
  'browser Blob copy plus full-buffer digest only; extension transport, prepare, detect, mode, and cache are not measured'
const profilerAvailabilityContract =
  'jsHeapSnapshotBytes is an after-sample snapshot, not a peak; process and WASM peak fields are null when unsupported'
const sha256Pattern = /^[a-f0-9]{64}$/u

function splitList(value) {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return parsed
}

export function parseArguments(argumentsList) {
  const options = {
    ...requiredBenchmarkDefaults,
    browsers: [...requiredBenchmarkDefaults.browsers],
    imageBytes: [...requiredBenchmarkDefaults.imageBytes],
    exhaustiveImageBytes: [...requiredBenchmarkDefaults.exhaustiveImageBytes],
    iterations: [...requiredBenchmarkDefaults.iterations],
    patterns: [...requiredBenchmarkDefaults.patterns],
    label: 'baseline',
    workload: 'transport',
    matrixProfile: requiredBenchmarkDefaults.matrixProfile,
    outputDirectory: process.env.BENCHMARK_OUTPUT_DIR || defaultOutputDirectory,
    artifactRoot: process.env.PACKAGED_EXTENSION_OUTPUT_ROOT || defaultArtifactRoot,
    dryRun: false,
    allowReducedSampling: false,
  }
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--') {
      continue
    }
    const readValue = () => {
      const value = argumentsList[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`)
      }
      index += 1
      return value
    }
    switch (argument) {
      case '--browser':
        options.browsers = splitList(readValue())
        break
      case '--image-bytes':
        options.imageBytes = splitList(readValue()).map((value) => parsePositiveInteger(value, 'image byte size'))
        options.matrixProfile = 'custom'
        break
      case '--iterations':
        options.iterations = splitList(readValue()).map((value) => parsePositiveInteger(value, 'iteration count'))
        options.matrixProfile = 'custom'
        break
      case '--pattern':
        options.patterns = splitList(readValue())
        options.matrixProfile = 'custom'
        break
      case '--invocations':
        options.invocations = parsePositiveInteger(readValue(), 'invocation count')
        break
      case '--warmups':
        options.warmups = Number(readValue())
        break
      case '--samples':
        options.samples = parsePositiveInteger(readValue(), 'sample count')
        break
      case '--label':
        options.label = readValue()
        break
      case '--workload':
        options.workload = readValue()
        if (options.workload !== 'transport') {
          throw new Error('Only the transport benchmark workload is implemented')
        }
        break
      case '--artifact-root':
        options.artifactRoot = path.resolve(readValue())
        break
      case '--output-dir':
        options.outputDirectory = path.resolve(readValue())
        break
      case '--exhaustive':
        options.imageBytes = [...requiredBenchmarkDefaults.exhaustiveImageBytes]
        options.matrixProfile = 'exhaustive'
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--quick':
        Object.assign(options, {
          browsers: ['chromium'],
          imageBytes: [1_024],
          iterations: [100],
          patterns: ['sequential', 'burst'],
          matrixProfile: 'representative',
          invocations: 1,
          warmups: 1,
          samples: 3,
          allowReducedSampling: true,
        })
        break
      default:
        throw new Error(`Unknown benchmark argument: ${argument}`)
    }
  }
  validateBenchmarkConfig(options, { allowReducedSampling: options.allowReducedSampling })
  return options
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function optionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function assertSha256(value, label) {
  if (!sha256Pattern.test(value ?? '')) {
    throw new Error(`${label} must be a lowercase SHA-256`)
  }
}

function assertArtifactFileRecord(record, label) {
  if (!record || typeof record !== 'object' || !Number.isSafeInteger(record.byteLength) || record.byteLength < 1) {
    throw new Error(`${label} has an invalid byte length`)
  }
  assertSha256(record.sha256, `${label} SHA-256`)
}

function assertSafeArchiveName(name, label) {
  if (typeof name !== 'string' || path.basename(name) !== name || !/^[A-Za-z0-9._-]+\.zip$/u.test(name)) {
    throw new Error(`${label} has an unsafe archive name`)
  }
}

function decodeJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error })
  }
}

async function verifyArtifactManifest(artifactRoot, artifact, artifactPath, browser) {
  if (!artifact || typeof artifact !== 'object' || artifact.target !== browser) {
    throw new Error(`Artifact ${artifactPath} does not identify target ${browser}`)
  }
  if (typeof artifact.version !== 'string' || artifact.version.trim().length === 0) {
    throw new Error(`Artifact ${artifactPath} is missing its version`)
  }
  if (!['remote', 'packaged'].includes(artifact.modelDelivery)) {
    throw new Error(`Artifact ${artifactPath} has an invalid model delivery`)
  }
  if (artifact.fixture !== undefined && typeof artifact.fixture !== 'boolean') {
    throw new Error(`Artifact ${artifactPath} has an invalid fixture flag`)
  }
  if (!artifact.archive || typeof artifact.archive !== 'object') {
    throw new Error(`Artifact ${artifactPath} is missing archive provenance`)
  }
  assertSafeArchiveName(artifact.archive.archiveName, `Artifact ${artifactPath}`)
  if (!Number.isSafeInteger(artifact.archive.byteLength) || artifact.archive.byteLength < 1) {
    throw new Error(`Artifact ${artifactPath} has an invalid archive byte length`)
  }
  assertSha256(artifact.archive.sha256, `Artifact ${artifactPath} archive`)
  const archivePath = path.join(artifactRoot, artifact.archive.archiveName)
  const archiveBytes = new Uint8Array(await readFile(archivePath))
  const archiveHash = sha256(archiveBytes)
  if (archiveBytes.byteLength !== artifact.archive.byteLength || archiveHash !== artifact.archive.sha256) {
    throw new Error(`Artifact ${artifactPath} archive provenance does not match ${artifact.archive.archiveName}`)
  }
  const checksumText = await readFile(`${archivePath}.sha256`, 'utf8')
  const checksumMatch = checksumText.match(/^([a-f0-9]{64}) {2}([^\n]+)\n?$/u)
  if (!checksumMatch || checksumMatch[1] !== archiveHash || checksumMatch[2] !== artifact.archive.archiveName) {
    throw new Error(`Artifact ${artifactPath} archive checksum sidecar is invalid`)
  }

  let archive
  try {
    archive = unzipSync(archiveBytes)
  } catch (error) {
    throw new Error(`Artifact ${artifactPath} archive is not a valid ZIP`, { cause: error })
  }
  const fileRecords = artifact.files
  if (!fileRecords || typeof fileRecords !== 'object' || Array.isArray(fileRecords)) {
    throw new Error(`Artifact ${artifactPath} is missing file provenance`)
  }
  for (const [name, record] of Object.entries(fileRecords)) {
    if (name === 'build-manifest.json' || !(name in archive)) {
      throw new Error(`Artifact ${artifactPath} file provenance is missing ${name}`)
    }
    assertArtifactFileRecord(record, `Artifact ${artifactPath} file ${name}`)
    if (archive[name].byteLength !== record.byteLength || sha256(archive[name]) !== record.sha256) {
      throw new Error(`Artifact ${artifactPath} file provenance does not match ${name}`)
    }
  }
  const unrecordedFiles = Object.keys(archive).filter(
    (name) => name !== 'build-manifest.json' && !(name in fileRecords),
  )
  if (unrecordedFiles.length > 0) {
    throw new Error(`Artifact ${artifactPath} has unrecorded archive files: ${unrecordedFiles.join(', ')}`)
  }
  const buildManifest = decodeJson(archive['build-manifest.json'], `${artifactPath} build manifest`)
  if (
    buildManifest.target !== browser ||
    buildManifest.version !== artifact.version ||
    buildManifest.modelDelivery !== artifact.modelDelivery ||
    (buildManifest.fixture === true) !== (artifact.fixture === true) ||
    (artifact.modelDelivery === 'packaged' && !isDeepStrictEqual(buildManifest.model, artifact.model)) ||
    (artifact.modelDelivery === 'remote' && 'model' in buildManifest) ||
    !isDeepStrictEqual(buildManifest.files, fileRecords)
  ) {
    throw new Error(`Artifact ${artifactPath} build-manifest provenance does not match artifact metadata`)
  }

  const wasmEntries = Object.keys(archive).filter((name) => name.endsWith('.wasm'))
  if (wasmEntries.length !== 1 || !fileRecords[wasmEntries[0]]) {
    throw new Error(`Artifact ${artifactPath} must contain exactly one recorded WASM asset`)
  }
  const wasmPath = wasmEntries[0]
  const wasmRecord = fileRecords[wasmPath]
  assertArtifactFileRecord(wasmRecord, `Artifact ${artifactPath} WASM`)

  const modelEntries = Object.keys(archive).filter((name) => name.endsWith('.ort'))
  let model = null
  if (artifact.modelDelivery === 'remote') {
    if (artifact.model !== undefined || modelEntries.length !== 0) {
      throw new Error(`Artifact ${artifactPath} remote provenance unexpectedly contains a model`)
    }
  } else {
    if (
      !artifact.model ||
      typeof artifact.model !== 'object' ||
      !/^[A-Za-z0-9._-]+\.ort$/u.test(artifact.model.filename ?? '')
    ) {
      throw new Error(`Artifact ${artifactPath} packaged provenance is missing model identity`)
    }
    if (!Number.isSafeInteger(artifact.model.byteLength) || artifact.model.byteLength < 1) {
      throw new Error(`Artifact ${artifactPath} packaged model byte length is invalid`)
    }
    assertSha256(artifact.model.sha256, `Artifact ${artifactPath} model`)
    const modelPath = `model/${artifact.model.filename}`
    if (modelEntries.length !== 1 || modelEntries[0] !== modelPath || !fileRecords[modelPath]) {
      throw new Error(`Artifact ${artifactPath} packaged model archive provenance is invalid`)
    }
    const modelBytes = archive[modelPath]
    if (
      modelBytes.byteLength !== artifact.model.byteLength ||
      sha256(modelBytes) !== artifact.model.sha256 ||
      fileRecords[modelPath].byteLength !== artifact.model.byteLength ||
      fileRecords[modelPath].sha256 !== artifact.model.sha256
    ) {
      throw new Error(`Artifact ${artifactPath} model provenance does not match archive bytes`)
    }
    model = { ...artifact.model }
  }

  return {
    target: browser,
    version: artifact.version,
    modelDelivery: artifact.modelDelivery,
    fixture: artifact.fixture === true,
    archive: {
      archiveName: artifact.archive.archiveName,
      byteLength: archiveBytes.byteLength,
      sha256: archiveHash,
    },
    model,
    wasm: {
      path: wasmPath,
      byteLength: wasmRecord.byteLength,
      sha256: wasmRecord.sha256,
    },
  }
}

export async function findArtifactIdentity(artifactRoot, browser) {
  let entries
  try {
    entries = await readdir(artifactRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
  const candidates = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.artifact.json')) {
      continue
    }
    const artifactPath = path.join(artifactRoot, entry.name)
    const artifact = await optionalJson(artifactPath)
    if (artifact?.target === browser) {
      candidates.push({ artifactPath, artifact })
    }
  }
  if (candidates.length === 0) {
    return null
  }
  if (candidates.length !== 1) {
    throw new Error(
      `Artifact discovery for ${browser} is ambiguous; found ${candidates.map(({ artifactPath }) => artifactPath).join(', ')}`,
    )
  }
  return verifyArtifactManifest(artifactRoot, candidates[0].artifact, candidates[0].artifactPath, browser)
}

async function repositoryIdentity() {
  return {
    sourceLockSha256: sha256(await readFile(path.join(repositoryRoot, 'pnpm-lock.yaml'))),
    gitSha: process.env.GITHUB_SHA || null,
  }
}

async function configureInvocationPage(browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.route('http://hv-benchmark.local/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><title>HV transport benchmark</title>',
    }),
  )
  await page.goto('http://hv-benchmark.local/', { waitUntil: 'domcontentloaded' })
  return {
    evaluate: (callback, argument) => page.evaluate(callback, argument),
    close: () => context.close(),
  }
}

async function launchChromium() {
  const executablePath = process.env.CHROMIUM_PATH || process.env.CHROME_PATH || undefined
  const browser = await chromium.launch({ executablePath, headless: true })
  const version = browser.version()
  assertSupportedBrowserVersion('chromium', version)
  return {
    browserVersion: version,
    newInvocation: () => configureInvocationPage(browser),
    close: () => browser.close(),
  }
}

async function launchFirefox() {
  const { firefox } = await import('@playwright/test')
  const executablePath = process.env.FIREFOX_EXECUTABLE_PATH || undefined
  const browser = await firefox.launch({ executablePath, headless: true })
  const version = browser.version()
  assertSupportedBrowserVersion('firefox', version)
  return {
    browserVersion: version,
    newInvocation: () => configureInvocationPage(browser),
    close: () => browser.close(),
  }
}

async function launchBrowser(browser) {
  return browser === 'chromium' ? launchChromium() : launchFirefox()
}

async function executeBrowserSample(adapter, scenario) {
  return adapter.evaluate(
    async ({ imageBytes, iterations, concurrency }) => {
      const payload = new Uint8Array(imageBytes)
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] = index % 251
      }
      const durations = []
      const digestPayload = async (bytes) => {
        if (globalThis.crypto?.subtle) {
          await globalThis.crypto.subtle.digest('SHA-256', bytes)
          return
        }
        // Some locally installed browser builds disable SubtleCrypto on this fixture host.
        const view = new Uint8Array(bytes)
        let accumulator = 2_166_136_261
        for (let index = 0; index < view.length; index += 1) {
          accumulator = Math.imul(accumulator ^ view[index], 16_777_619)
        }
        globalThis.__hvBenchmarkDigest = accumulator >>> 0
      }
      const performOne = async (enqueuedAt) => {
        const startedAt = globalThis.performance.now()
        queueAgeMaxMs = Math.max(queueAgeMaxMs, startedAt - enqueuedAt)
        active += 1
        queueDepthMax = Math.max(queueDepthMax, active)
        const copied = (await new globalThis.Blob([payload]).arrayBuffer()).slice(0)
        await digestPayload(copied)
        digestCount += 1
        digestBytes += copied.byteLength
        durations.push(globalThis.performance.now() - startedAt)
        active -= 1
      }
      let active = 0
      let queueDepthMax = 0
      let queueAgeMaxMs = 0
      let digestCount = 0
      let digestBytes = 0
      const startedAt = globalThis.performance.now()
      for (let offset = 0; offset < iterations; offset += concurrency) {
        const batch = []
        for (let member = 0; member < concurrency && offset + member < iterations; member += 1) {
          batch.push(performOne(globalThis.performance.now()))
        }
        await Promise.all(batch)
      }
      const durationMs = globalThis.performance.now() - startedAt
      let jsHeapSnapshotBytes = null
      let jsHeapMeasurementKind = 'unsupported'
      if (typeof globalThis.performance.measureUserAgentSpecificMemory === 'function') {
        try {
          jsHeapSnapshotBytes = (await globalThis.performance.measureUserAgentSpecificMemory()).bytes
          jsHeapMeasurementKind = 'snapshot'
        } catch {
          // Profiler availability is recorded explicitly instead of substituting a fake peak.
        }
      }
      return {
        durationMs,
        perOperationMs: durationMs / iterations,
        successCount: durations.length,
        errorCount: Math.max(0, iterations - durations.length),
        digestCount,
        digestBytes,
        idbOperationCount: 0,
        prepareCount: 0,
        prepareRoundtripMs: null,
        queueAgeMaxMs,
        queueDepthMax,
        profiler: {
          available: jsHeapMeasurementKind === 'snapshot',
          jsHeapSnapshotBytes,
          jsHeapMeasurementKind,
          processPeakBytes: null,
          processMeasurementKind: 'unsupported',
          wasmMemoryPeakBytes: null,
          wasmMeasurementKind: 'unsupported',
          gcCount: null,
        },
      }
    },
    { imageBytes: scenario.imageBytes, iterations: scenario.iterations, concurrency: scenario.concurrency },
  )
}

async function executeInvocation(session, scenario, index, options) {
  const adapter = await session.newInvocation()
  try {
    const warmupSamples = []
    for (let sampleIndex = 0; sampleIndex < options.warmups; sampleIndex += 1) {
      warmupSamples.push(await executeBrowserSample(adapter, scenario))
    }
    const measuredSamples = []
    for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
      measuredSamples.push(await executeBrowserSample(adapter, scenario))
    }
    return {
      index,
      browserVersion: session.browserVersion,
      driverVersion: scenario.browser === 'firefox' ? process.env.GECKODRIVER_VERSION || null : null,
      warmupSamples,
      measuredSamples,
      summary: summarizeMeasuredSamples(measuredSamples),
    }
  } finally {
    await adapter.close()
  }
}

function resultConfig(options) {
  return {
    workload: options.workload,
    workloadContract: transportWorkloadContract,
    matrixProfile: options.matrixProfile,
    browsers: [...options.browsers],
    imageBytes: [...options.imageBytes],
    iterations: [...options.iterations],
    patterns: [...options.patterns],
    burstConcurrency: options.burstConcurrency,
    invocations: options.invocations,
    warmups: options.warmups,
    samples: options.samples,
    allowReducedSampling: options.allowReducedSampling,
    browserReuse: true,
    browserReuseContract: 'one browser process per browser and one fresh browser context per invocation',
    profilerAvailabilityContract,
  }
}

export async function main(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList)
  const matrix = buildScenarioMatrix(options)
  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: benchmarkSchemaVersion, config: resultConfig(options), scenarios: matrix }, null, 2)}\n`,
    )
    return
  }
  const cpuList = os.cpus()
  const artifactByBrowser = new Map()
  for (const browser of options.browsers) {
    artifactByBrowser.set(browser, await findArtifactIdentity(options.artifactRoot, browser))
  }
  const result = {
    schemaVersion: benchmarkSchemaVersion,
    label: options.label,
    createdAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpu: cpuList[0]?.model ?? null,
      logicalCpuCount: cpuList.length,
      totalMemoryBytes: os.totalmem(),
      ...(await repositoryIdentity()),
    },
    config: resultConfig(options),
    scenarios: [],
  }
  const sessions = new Map()
  try {
    for (const browser of options.browsers) {
      sessions.set(browser, await launchBrowser(browser))
    }
    for (const scenario of matrix) {
      const session = sessions.get(scenario.browser)
      const scenarioResult = {
        ...scenario,
        artifact: artifactByBrowser.get(scenario.browser),
        invocations: [],
      }
      for (let invocation = 0; invocation < options.invocations; invocation += 1) {
        scenarioResult.invocations.push(await executeInvocation(session, scenario, invocation, options))
      }
      result.scenarios.push(scenarioResult)
    }
  } finally {
    await Promise.all([...sessions.values()].map((session) => session.close()))
  }
  validateBenchmarkResult(result, { allowReducedSampling: options.allowReducedSampling })
  await mkdir(options.outputDirectory, { recursive: true })
  const basename = `extension-${options.label.replaceAll(/[^a-zA-Z0-9._-]/gu, '-')}`
  const jsonPath = path.join(options.outputDirectory, `${basename}.json`)
  const csvPath = path.join(options.outputDirectory, `${basename}.csv`)
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`),
    writeFile(csvPath, renderBenchmarkCsv(result)),
  ])
  process.stdout.write(`${jsonPath}\n${csvPath}\n`)
  return result
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  await main()
}
