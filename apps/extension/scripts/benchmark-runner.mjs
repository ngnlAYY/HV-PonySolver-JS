import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

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

function splitList(value) {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return parsed
}

function parseArguments(argumentsList) {
  const options = {
    ...requiredBenchmarkDefaults,
    browsers: [...requiredBenchmarkDefaults.browsers],
    modes: [...requiredBenchmarkDefaults.modes],
    caches: [...requiredBenchmarkDefaults.caches],
    imageBytes: [...requiredBenchmarkDefaults.imageBytes],
    iterations: [...requiredBenchmarkDefaults.iterations],
    patterns: [...requiredBenchmarkDefaults.patterns],
    label: 'baseline',
    workload: 'transport',
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
      case '--mode':
        options.modes = splitList(readValue())
        break
      case '--cache':
        options.caches = splitList(readValue())
        break
      case '--image-bytes':
        options.imageBytes = splitList(readValue()).map((value) => parsePositiveInteger(value, 'image byte size'))
        break
      case '--iterations':
        options.iterations = splitList(readValue()).map((value) => parsePositiveInteger(value, 'iteration count'))
        break
      case '--pattern':
        options.patterns = splitList(readValue())
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
      case '--output-dir':
        options.outputDirectory = path.resolve(readValue())
        break
      case '--artifact-root':
        options.artifactRoot = path.resolve(readValue())
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--quick':
        Object.assign(options, {
          browsers: ['chromium'],
          modes: ['remote'],
          caches: ['warm'],
          imageBytes: [1_024],
          iterations: [100],
          patterns: ['sequential', 'burst'],
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

async function findArtifactIdentity(artifactRoot, browser, mode) {
  const artifactPath = path.join(artifactRoot, `hv-pony-solver-${browser}-${mode}-0.1.0.artifact.json`)
  const fixturePath = path.join(artifactRoot, `hv-pony-solver-${browser}-${mode}-fixture-0.1.0.artifact.json`)
  const artifact = await optionalJson(artifactPath) ?? await optionalJson(fixturePath)
  if (!artifact) {
    return null
  }
  const wasmEntry = Object.entries(artifact.files ?? {}).find(([name]) => name.endsWith('.wasm'))
  return {
    fixture: artifact.fixture === true,
    archiveSha256: artifact.archive?.sha256 ?? null,
    modelSha256: artifact.model?.sha256 ?? null,
    wasmSha256: wasmEntry?.[1]?.sha256 ?? null,
  }
}

async function repositoryIdentity() {
  return {
    sourceLockSha256: sha256(await readFile(path.join(repositoryRoot, 'pnpm-lock.yaml'))),
    gitSha: process.env.GITHUB_SHA || null,
  }
}

async function launchChromium() {
  const executablePath = process.env.CHROMIUM_PATH || process.env.CHROME_PATH || undefined
  const browser = await chromium.launch({ executablePath, headless: true })
  const version = browser.version()
  assertSupportedBrowserVersion('chromium', version)
  const page = await browser.newPage()
  await page.route('http://hv-benchmark.local/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><title>HV benchmark</title>',
  }))
  await page.goto('http://hv-benchmark.local/', { waitUntil: 'domcontentloaded' })
  return {
    browserVersion: version,
    close: () => browser.close(),
    evaluate: (callback, argument) => page.evaluate(callback, argument),
  }
}

async function launchFirefox() {
  const { firefox } = await import('@playwright/test')
  const executablePath = process.env.FIREFOX_EXECUTABLE_PATH || undefined
  const browser = await firefox.launch({ executablePath, headless: true })
  const version = browser.version()
  assertSupportedBrowserVersion('firefox', version)
  const page = await browser.newPage()
  await page.route('http://hv-benchmark.local/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><title>HV benchmark</title>',
  }))
  await page.goto('http://hv-benchmark.local/', { waitUntil: 'domcontentloaded' })
  return {
    browserVersion: version,
    close: () => browser.close(),
    evaluate: (callback, argument) => page.evaluate(callback, argument),
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
      const supportsMemory = typeof globalThis.performance.measureUserAgentSpecificMemory === 'function'
      const beforeMemory = supportsMemory ? await globalThis.performance.measureUserAgentSpecificMemory() : null
      let active = 0
      let queueDepthMax = 0
      let queueAgeMaxMs = 0
      let digestCount = 0
      let digestBytes = 0
      const digestPayload = async (bytes) => {
        if (globalThis.crypto?.subtle) {
          await globalThis.crypto.subtle.digest('SHA-256', bytes)
          return
        }
        // Some locally installed browser builds disable SubtleCrypto on data: URLs.
        // Keep the same bounded full-buffer read and record profiler availability.
        const view = new Uint8Array(bytes)
        let accumulator = 2_166_136_261
        for (let index = 0; index < view.length; index += 1) {
          accumulator = Math.imul(accumulator ^ view[index], 16_777_619)
        }
        globalThis.__hvBenchmarkDigest = accumulator >>> 0
      }
      const performOne = async (enqueuedAt) => {
        queueAgeMaxMs = Math.max(queueAgeMaxMs, globalThis.performance.now() - enqueuedAt)
        active += 1
        queueDepthMax = Math.max(queueDepthMax, active)
        const startedAt = globalThis.performance.now()
        const copied = (await new globalThis.Blob([payload]).arrayBuffer()).slice(0)
        await digestPayload(copied)
        digestCount += 1
        digestBytes += copied.byteLength
        durations.push(globalThis.performance.now() - startedAt)
        active -= 1
      }
      const startedAt = globalThis.performance.now()
      for (let offset = 0; offset < iterations; offset += concurrency) {
        const batch = []
        for (let member = 0; member < concurrency && offset + member < iterations; member += 1) {
          batch.push(performOne(globalThis.performance.now()))
        }
        await Promise.all(batch)
      }
      const durationMs = globalThis.performance.now() - startedAt
      const afterMemory = supportsMemory ? await globalThis.performance.measureUserAgentSpecificMemory() : null
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
          available: supportsMemory,
          jsHeapPeakBytes: afterMemory?.bytes ?? beforeMemory?.bytes ?? null,
          processPeakBytes: null,
          wasmMemoryPeakBytes: null,
          gcCount: null,
        },
      }
    },
    { imageBytes: scenario.imageBytes, iterations: scenario.iterations, concurrency: scenario.concurrency },
  )
}

async function executeInvocation(scenario, index, options) {
  const adapter = await launchBrowser(scenario.browser)
  try {
    if (scenario.cache === 'cold') {
      await adapter.evaluate(() => Promise.all([
        typeof globalThis.caches === 'undefined'
          ? Promise.resolve()
          : globalThis.caches.keys().then((keys) => Promise.all(keys.map((key) => globalThis.caches.delete(key)))),
        new Promise((resolve, reject) => {
          const request = globalThis.indexedDB.deleteDatabase('hv-pony-solver')
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
          request.onblocked = () => resolve()
        }),
      ]))
    }
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
      browserVersion: adapter.browserVersion,
      driverVersion: scenario.browser === 'firefox' ? process.env.GECKODRIVER_VERSION || null : null,
      warmupSamples,
      measuredSamples,
      summary: summarizeMeasuredSamples(measuredSamples),
    }
  } finally {
    await adapter.close()
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const matrix = buildScenarioMatrix(options)
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: benchmarkSchemaVersion, config: options, scenarios: matrix }, null, 2)}\n`)
    return
  }
  const cpuList = os.cpus()
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
    config: {
      workload: options.workload,
      workloadContract: 'browser Blob copy plus full-buffer digest; extension inference is not measured',
      invocations: options.invocations,
      warmups: options.warmups,
      samples: options.samples,
      profilerAvailabilityContract: 'unsupported fields are null',
    },
    scenarios: [],
  }
  for (const scenario of matrix) {
    const scenarioResult = {
      ...scenario,
      artifact: await findArtifactIdentity(options.artifactRoot, scenario.browser, scenario.mode),
      invocations: [],
    }
    for (let invocation = 0; invocation < options.invocations; invocation += 1) {
      scenarioResult.invocations.push(await executeInvocation(scenario, invocation, options))
    }
    result.scenarios.push(scenarioResult)
  }
  if (!options.allowReducedSampling) {
    validateBenchmarkResult(result)
  }
  await mkdir(options.outputDirectory, { recursive: true })
  const basename = `extension-${options.label.replaceAll(/[^a-zA-Z0-9._-]/gu, '-')}`
  const jsonPath = path.join(options.outputDirectory, `${basename}.json`)
  const csvPath = path.join(options.outputDirectory, `${basename}.csv`)
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`),
    writeFile(csvPath, renderBenchmarkCsv(result)),
  ])
  process.stdout.write(`${jsonPath}\n${csvPath}\n`)
}

await main()
