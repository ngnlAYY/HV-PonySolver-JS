import { isDeepStrictEqual } from 'node:util'

import { assertSupportedBrowserVersion } from '../browser/browser-support.mjs'
import {
  assertPositiveIntegers,
  assertUniqueAllowed,
  benchmarkSchemaVersion,
  buildScenarioMatrix,
  scenarioKey,
  supportedBrowsers,
  supportedPatterns,
  validateBenchmarkConfig,
} from './benchmark-config.mjs'
import { summarizeMeasuredSamples } from './benchmark-statistics.mjs'

const supportedProfilerMeasurementKinds = new Set(['unsupported', 'snapshot', 'peak'])
const sha256Pattern = /^[a-f0-9]{64}$/u

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
}

function artifactComparisonIdentity(artifact) {
  if (artifact === null) return null
  return {
    target: artifact.target,
    version: artifact.version,
    modelDelivery: artifact.modelDelivery,
    fixture: artifact.fixture,
    model: artifact.model,
    wasm: artifact.wasm,
  }
}

function assertFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`)
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative integer`)
  }
}

function validateProfiler(profiler, label) {
  if (profiler === null) {
    return
  }
  if (!profiler || typeof profiler !== 'object') {
    throw new Error(`${label} profiler must be an object or null`)
  }
  if ('jsHeapPeakBytes' in profiler) {
    throw new Error(`${label} uses the retired jsHeapPeakBytes snapshot field`)
  }
  for (const field of [
    'available',
    'jsHeapSnapshotBytes',
    'jsHeapMeasurementKind',
    'processPeakBytes',
    'processMeasurementKind',
    'wasmMemoryPeakBytes',
    'wasmMeasurementKind',
    'gcCount',
  ]) {
    if (!(field in profiler)) {
      throw new Error(`${label} profiler is missing ${field}`)
    }
  }
  if (typeof profiler.available !== 'boolean') {
    throw new Error(`${label} profiler availability must be boolean`)
  }
  for (const field of ['jsHeapMeasurementKind', 'processMeasurementKind', 'wasmMeasurementKind']) {
    if (!supportedProfilerMeasurementKinds.has(profiler[field])) {
      throw new Error(`${label} profiler has invalid ${field}`)
    }
  }
  if (profiler.available) {
    if (
      profiler.jsHeapMeasurementKind !== 'snapshot' ||
      !Number.isFinite(profiler.jsHeapSnapshotBytes) ||
      profiler.jsHeapSnapshotBytes < 0
    ) {
      throw new Error(`${label} available JS heap profiler must report a snapshot`)
    }
  } else if (profiler.jsHeapMeasurementKind !== 'unsupported' || profiler.jsHeapSnapshotBytes !== null) {
    throw new Error(`${label} unavailable JS heap profiler must be explicitly null`)
  }
  for (const [field, kindField] of [
    ['processPeakBytes', 'processMeasurementKind'],
    ['wasmMemoryPeakBytes', 'wasmMeasurementKind'],
  ]) {
    if (profiler[field] === null) {
      if (profiler[kindField] !== 'unsupported') {
        throw new Error(`${label} ${field} is null without an unsupported measurement kind`)
      }
    } else if (!Number.isFinite(profiler[field]) || profiler[field] < 0 || profiler[kindField] !== 'peak') {
      throw new Error(`${label} ${field} must be a finite peak measurement or null`)
    }
  }
  if (profiler.gcCount !== null) {
    assertNonNegativeInteger(profiler.gcCount, `${label} gcCount`)
  }
}

function validateArtifactIdentity(artifact, browser, label) {
  if (artifact === null) {
    return
  }
  if (!artifact || typeof artifact !== 'object') {
    throw new Error(`${label} artifact identity must be an object or null`)
  }
  if (artifact.target !== browser) {
    throw new Error(`${label} artifact target does not match browser`)
  }
  assertNonEmptyString(artifact.version, `${label} artifact version`)
  if (!['remote', 'packaged'].includes(artifact.modelDelivery)) {
    throw new Error(`${label} artifact model delivery is invalid`)
  }
  if (typeof artifact.fixture !== 'boolean') {
    throw new Error(`${label} artifact fixture flag must be boolean`)
  }
  if (
    !artifact.archive ||
    typeof artifact.archive !== 'object' ||
    !/^[A-Za-z0-9._-]+\.zip$/u.test(artifact.archive.archiveName ?? '')
  ) {
    throw new Error(`${label} artifact archive identity is invalid`)
  }
  if (artifact.archive.byteLength <= 0) {
    throw new Error(`${label} artifact archive byteLength must be positive`)
  }
  assertNonNegativeInteger(artifact.archive.byteLength, `${label} artifact archive byteLength`)
  if (!sha256Pattern.test(artifact.archive.sha256 ?? '')) {
    throw new Error(`${label} artifact archive SHA-256 is invalid`)
  }
  if (!artifact.wasm || typeof artifact.wasm !== 'object' || !artifact.wasm.path?.endsWith('.wasm')) {
    throw new Error(`${label} artifact WASM identity is invalid`)
  }
  if (artifact.wasm.byteLength <= 0) {
    throw new Error(`${label} artifact WASM byteLength must be positive`)
  }
  assertNonNegativeInteger(artifact.wasm.byteLength, `${label} artifact WASM byteLength`)
  if (!sha256Pattern.test(artifact.wasm.sha256 ?? '')) {
    throw new Error(`${label} artifact WASM SHA-256 is invalid`)
  }
  if (!Object.hasOwn(artifact, 'model')) {
    throw new Error(`${label} artifact model provenance is missing`)
  }
  if (artifact.model === null) {
    if (artifact.modelDelivery !== 'remote') {
      throw new Error(`${label} packaged artifact is missing model provenance`)
    }
  } else {
    if (artifact.modelDelivery !== 'packaged' || !artifact.model.filename?.endsWith('.ort')) {
      throw new Error(`${label} artifact model provenance is invalid`)
    }
    assertNonNegativeInteger(artifact.model.byteLength, `${label} artifact model byteLength`)
    if (!sha256Pattern.test(artifact.model.sha256 ?? '')) {
      throw new Error(`${label} artifact model SHA-256 is invalid`)
    }
  }
}

function validateEnvironment(environment) {
  if (!environment || typeof environment !== 'object') {
    throw new Error('Benchmark result environment is required')
  }
  for (const field of ['nodeVersion', 'platform', 'arch', 'release', 'cpu']) {
    assertNonEmptyString(environment[field], `Benchmark environment ${field}`)
  }
  if (!Number.isSafeInteger(environment.logicalCpuCount) || environment.logicalCpuCount < 1) {
    throw new Error('Benchmark environment logicalCpuCount must be a positive integer')
  }
  assertNonNegativeInteger(environment.totalMemoryBytes, 'Benchmark environment totalMemoryBytes')
  if (!sha256Pattern.test(environment.sourceLockSha256 ?? '')) {
    throw new Error('Benchmark environment sourceLockSha256 must be a SHA-256')
  }
  if (environment.gitSha !== null && typeof environment.gitSha !== 'string') {
    throw new Error('Benchmark environment gitSha must be a string or null')
  }
}

function validateSample(sample, scenario, label) {
  if (!sample || typeof sample !== 'object') {
    throw new Error(`${label} sample must be an object`)
  }
  for (const field of [
    'durationMs',
    'perOperationMs',
    'successCount',
    'errorCount',
    'digestCount',
    'digestBytes',
    'idbOperationCount',
    'queueAgeMaxMs',
    'queueDepthMax',
  ]) {
    assertFiniteNonNegative(sample[field], `${label} ${field}`)
  }
  for (const field of [
    'successCount',
    'errorCount',
    'digestCount',
    'digestBytes',
    'idbOperationCount',
    'queueDepthMax',
  ]) {
    assertNonNegativeInteger(sample[field], `${label} ${field}`)
  }
  if (sample.prepareCount !== 0 || sample.idbOperationCount !== 0 || sample.prepareRoundtripMs !== null) {
    throw new Error(`${label} transport sample must not report extension prepare or IDB work`)
  }
  const expectedDigestBytes = scenario.imageBytes * scenario.iterations
  if (!Number.isSafeInteger(expectedDigestBytes)) {
    throw new Error(`${label} digest byte count exceeds safe integer range`)
  }
  if (sample.successCount !== scenario.iterations || sample.errorCount !== 0) {
    throw new Error(`${label} transport sample did not complete every operation`)
  }
  if (sample.digestCount !== scenario.iterations || sample.digestBytes !== expectedDigestBytes) {
    throw new Error(`${label} transport sample digest accounting is inconsistent`)
  }
  if (sample.queueDepthMax > scenario.concurrency) {
    throw new Error(`${label} queue depth exceeds scenario concurrency`)
  }
  const expectedDuration = sample.perOperationMs * scenario.iterations
  const durationTolerance = Math.max(1e-9, Math.abs(sample.durationMs) * 1e-9)
  if (Math.abs(expectedDuration - sample.durationMs) > durationTolerance) {
    throw new Error(`${label} duration and per-operation time disagree`)
  }
  validateProfiler(sample.profiler, label)
}

function assertSummaryMatchesSamples(invocation, scenario, label) {
  const expected = summarizeMeasuredSamples(invocation.measuredSamples)
  if (!isDeepStrictEqual(invocation.summary, expected)) {
    throw new Error(`${label} summary does not match raw measuredSamples`)
  }
}

export function validateBenchmarkResult(result, options = {}) {
  if (result?.schemaVersion !== benchmarkSchemaVersion) {
    const version = result?.schemaVersion ?? 'missing'
    throw new Error(`Unsupported benchmark result schema ${version}; regenerate with schema ${benchmarkSchemaVersion}`)
  }
  if (!Array.isArray(result.scenarios)) {
    throw new Error('Benchmark result scenarios must be an array')
  }
  assertNonEmptyString(result.label, 'Benchmark result label')
  assertNonEmptyString(result.createdAt, 'Benchmark result createdAt')
  if (Number.isNaN(Date.parse(result.createdAt))) {
    throw new Error('Benchmark result createdAt must be an ISO date')
  }
  validateEnvironment(result.environment)
  if (!result.config || typeof result.config !== 'object') {
    throw new Error('Benchmark result config is required')
  }
  if (result.config.browserReuse !== true) {
    throw new Error('Benchmark result must declare browser process reuse')
  }
  if (
    result.config.browserReuseContract !==
    'one browser process per browser and one fresh browser context per invocation'
  ) {
    throw new Error('Benchmark result has an invalid browser reuse contract')
  }
  if (
    result.config.workloadContract !==
    'browser Blob copy plus full-buffer digest only; extension transport, prepare, detect, mode, and cache are not measured'
  ) {
    throw new Error('Benchmark result has an invalid transport workload contract')
  }
  if (
    result.config.profilerAvailabilityContract !==
    'jsHeapSnapshotBytes is an after-sample snapshot, not a peak; process and WASM peak fields are null when unsupported'
  ) {
    throw new Error('Benchmark result has an invalid profiler contract')
  }
  const allowReducedSampling = options.allowReducedSampling === true
  validateBenchmarkConfig(result.config, { allowReducedSampling })
  const expectedKeys = options.expectedConfig
    ? new Set(buildScenarioMatrix(options.expectedConfig).map(({ key }) => key))
    : new Set(buildScenarioMatrix(result.config).map(({ key }) => key))
  const seenKeys = new Set()
  const artifactByBrowser = new Map()
  const runtimeByBrowser = new Map()
  for (const scenario of result.scenarios) {
    assertUniqueAllowed([scenario.browser], supportedBrowsers, 'result browser')
    assertUniqueAllowed([scenario.pattern], supportedPatterns, 'result pattern')
    assertPositiveIntegers([scenario.imageBytes], 'result image byte size')
    assertPositiveIntegers([scenario.iterations], 'result iteration count')
    const expectedConcurrency = scenario.pattern === 'burst' ? 6 : 1
    if (scenario.concurrency !== expectedConcurrency) {
      throw new Error(`${scenario.key} has invalid concurrency ${scenario.concurrency}`)
    }
    if (scenario.key !== scenarioKey(scenario)) {
      throw new Error(`Benchmark scenario key mismatch: ${scenario.key}`)
    }
    if (seenKeys.has(scenario.key)) {
      throw new Error(`Duplicate benchmark scenario ${scenario.key}`)
    }
    seenKeys.add(scenario.key)
    validateArtifactIdentity(scenario.artifact, scenario.browser, `${scenario.key}`)
    const artifactFingerprint = JSON.stringify(artifactComparisonIdentity(scenario.artifact))
    if (artifactByBrowser.has(scenario.browser) && artifactByBrowser.get(scenario.browser) !== artifactFingerprint) {
      throw new Error(`${scenario.key} changes artifact provenance within one browser result`)
    }
    artifactByBrowser.set(scenario.browser, artifactFingerprint)
    if (!Array.isArray(scenario.invocations) || scenario.invocations.length < (allowReducedSampling ? 1 : 3)) {
      throw new Error(`${scenario.key} has fewer than ${allowReducedSampling ? 1 : 3} independent invocations`)
    }
    const invocationIndices = new Set()
    const browserVersions = new Set()
    const driverVersions = new Set()
    for (const invocation of scenario.invocations) {
      if (!Number.isSafeInteger(invocation.index) || invocation.index < 0 || invocationIndices.has(invocation.index)) {
        throw new Error(`${scenario.key} has an invalid or duplicate invocation index`)
      }
      invocationIndices.add(invocation.index)
      assertNonEmptyString(invocation.browserVersion, `${scenario.key} browserVersion`)
      assertSupportedBrowserVersion(scenario.browser, invocation.browserVersion)
      browserVersions.add(invocation.browserVersion)
      if (
        !('driverVersion' in invocation) ||
        (invocation.driverVersion !== null && typeof invocation.driverVersion !== 'string')
      ) {
        throw new Error(`${scenario.key} invocation driverVersion must be a string or null`)
      }
      driverVersions.add(invocation.driverVersion)
      const minimumWarmups = allowReducedSampling ? 0 : 3
      const minimumSamples = allowReducedSampling ? 1 : 10
      if (!Array.isArray(invocation.warmupSamples) || invocation.warmupSamples.length < minimumWarmups) {
        throw new Error(`${scenario.key} invocation ${invocation.index} has insufficient warmup samples`)
      }
      if (!Array.isArray(invocation.measuredSamples) || invocation.measuredSamples.length < minimumSamples) {
        throw new Error(`${scenario.key} invocation ${invocation.index} has insufficient measured samples`)
      }
      for (const [sampleIndex, sample] of [...invocation.warmupSamples, ...invocation.measuredSamples].entries()) {
        validateSample(sample, scenario, `${scenario.key} invocation ${invocation.index} sample ${sampleIndex}`)
      }
      if (invocation.measuredSamples.some((sample) => sample.errorCount !== 0)) {
        throw new Error(`${scenario.key} invocation ${invocation.index} has correctness failures`)
      }
      if (!invocation.summary || typeof invocation.summary !== 'object') {
        throw new Error(`${scenario.key} invocation ${invocation.index} summary is required`)
      }
      assertSummaryMatchesSamples(invocation, scenario, `${scenario.key} invocation ${invocation.index}`)
    }
    if (browserVersions.size !== 1 || driverVersions.size !== 1) {
      throw new Error(`${scenario.key} uses multiple browser or driver versions across invocations`)
    }
    const runtimeIdentity = [scenario.browser, [...browserVersions][0], [...driverVersions][0]]
    const knownRuntimeIdentity = runtimeByBrowser.get(scenario.browser)
    if (knownRuntimeIdentity && !isDeepStrictEqual(knownRuntimeIdentity, runtimeIdentity)) {
      throw new Error(`${scenario.key} browser or driver versions differ within the result`)
    }
    runtimeByBrowser.set(scenario.browser, runtimeIdentity)
  }
  if (expectedKeys.size !== seenKeys.size || [...expectedKeys].some((key) => !seenKeys.has(key))) {
    throw new Error('Benchmark result does not contain the complete configured matrix')
  }
  return result
}
