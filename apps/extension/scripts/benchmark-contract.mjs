import { isDeepStrictEqual } from 'node:util'

import { assertSupportedBrowserVersion } from './browser-support.mjs'

const transportWorkload = 'transport'
const supportedBrowsers = new Set(['chromium', 'firefox'])
const supportedPatterns = new Set(['sequential', 'burst'])
const supportedMatrixProfiles = new Set(['representative', 'exhaustive', 'custom'])
const supportedProfilerMeasurementKinds = new Set(['unsupported', 'snapshot', 'peak'])
const sha256Pattern = /^[a-f0-9]{64}$/u

export const benchmarkSchemaVersion = 2
export const benchmarkWorkload = transportWorkload

export const requiredBenchmarkDefaults = Object.freeze({
  workload: transportWorkload,
  browsers: Object.freeze(['chromium', 'firefox']),
  // The default is deliberately representative. Use --exhaustive for all three sizes.
  imageBytes: Object.freeze([1_024, 2_097_152]),
  exhaustiveImageBytes: Object.freeze([1_024, 262_144, 2_097_152]),
  iterations: Object.freeze([100, 1_000]),
  patterns: Object.freeze(['sequential', 'burst']),
  matrixProfile: 'representative',
  invocations: 3,
  warmups: 3,
  samples: 10,
  burstConcurrency: 6,
})

function assertUniqueAllowed(values, allowed, label) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !allowed.has(value))) {
    throw new Error(`Invalid benchmark ${label}: ${JSON.stringify(values)}`)
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`Benchmark ${label} must be unique`)
  }
}

function assertPositiveIntegers(values, label) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new Error(`Invalid benchmark ${label}: ${JSON.stringify(values)}`)
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`Benchmark ${label} must be unique`)
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
}

function sameNumberList(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

export function validateBenchmarkConfig(config, options = {}) {
  if (!config || typeof config !== 'object') {
    throw new Error('Benchmark config must be an object')
  }
  if (config.workload !== transportWorkload) {
    throw new Error('Only the transport benchmark workload is supported')
  }
  if ('modes' in config || 'caches' in config) {
    throw new Error('Transport benchmarks do not support extension mode or cache dimensions')
  }
  assertUniqueAllowed(config.browsers, supportedBrowsers, 'browsers')
  assertUniqueAllowed(config.patterns, supportedPatterns, 'patterns')
  assertPositiveIntegers(config.imageBytes, 'image byte sizes')
  assertPositiveIntegers(config.iterations, 'iteration counts')
  if (!supportedMatrixProfiles.has(config.matrixProfile)) {
    throw new Error(`Invalid benchmark matrix profile: ${config.matrixProfile}`)
  }
  if (
    config.matrixProfile === 'exhaustive' &&
    !sameNumberList(config.imageBytes, requiredBenchmarkDefaults.exhaustiveImageBytes)
  ) {
    throw new Error('The exhaustive benchmark profile must include all configured image sizes')
  }
  if (!Number.isSafeInteger(config.burstConcurrency) || config.burstConcurrency !== 6) {
    throw new Error('Benchmark burst concurrency must remain 6')
  }
  const allowReducedSampling = options.allowReducedSampling === true
  const minimumInvocations = allowReducedSampling ? 1 : requiredBenchmarkDefaults.invocations
  const minimumWarmups = allowReducedSampling ? 0 : requiredBenchmarkDefaults.warmups
  const minimumSamples = allowReducedSampling ? 1 : requiredBenchmarkDefaults.samples
  if (!Number.isSafeInteger(config.invocations) || config.invocations < minimumInvocations) {
    throw new Error(`Benchmark requires at least ${minimumInvocations} independent invocations`)
  }
  if (!Number.isSafeInteger(config.warmups) || config.warmups < minimumWarmups) {
    throw new Error(`Benchmark requires at least ${minimumWarmups} warmups per invocation`)
  }
  if (!Number.isSafeInteger(config.samples) || config.samples < minimumSamples) {
    throw new Error(`Benchmark requires at least ${minimumSamples} measured samples per invocation`)
  }
  return config
}

export function scenarioKey(scenario) {
  return [scenario.browser, scenario.imageBytes, scenario.iterations, scenario.pattern, scenario.concurrency].join(':')
}

export function buildScenarioMatrix(config) {
  validateBenchmarkConfig(config, { allowReducedSampling: config.allowReducedSampling === true })
  const scenarios = []
  for (const browser of config.browsers) {
    for (const imageBytes of config.imageBytes) {
      for (const iterations of config.iterations) {
        for (const pattern of config.patterns) {
          const concurrency = pattern === 'burst' ? config.burstConcurrency : 1
          const scenario = { browser, imageBytes, iterations, pattern, concurrency }
          scenarios.push({ ...scenario, key: scenarioKey(scenario) })
        }
      }
    }
  }
  return scenarios
}

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Cannot calculate a median without samples')
  }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Cannot calculate a percentile without samples')
  }
  if (!Number.isFinite(percentileValue) || percentileValue < 0 || percentileValue > 1) {
    throw new Error(`Invalid percentile: ${percentileValue}`)
  }
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.ceil(percentileValue * sorted.length) - 1
  return sorted[Math.max(0, index)]
}

function standardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

export function deterministicBootstrapCi(values, options = {}) {
  if (!Array.isArray(values) || values.length < 2 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Bootstrap input requires at least two finite samples')
  }
  const resamples = options.resamples ?? 2_000
  const seed = options.seed ?? 0x4856_5053
  const statistic = options.statistic ?? median
  if (!Number.isSafeInteger(resamples) || resamples < 100) {
    throw new Error('Bootstrap requires at least 100 resamples')
  }
  const random = seededRandom(seed)
  const estimates = []
  for (let sampleIndex = 0; sampleIndex < resamples; sampleIndex += 1) {
    const sample = []
    for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
      sample.push(values[Math.floor(random() * values.length)])
    }
    estimates.push(statistic(sample))
  }
  return {
    low: percentile(estimates, 0.025),
    high: percentile(estimates, 0.975),
    resamples,
    seed,
  }
}

function maximumFinite(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value))
  return finiteValues.length > 0 ? Math.max(...finiteValues) : null
}

export function summarizeMeasuredSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('Cannot summarize an empty benchmark sample set')
  }
  const perOperationMs = samples.map((sample) => sample.perOperationMs)
  return {
    sampleCount: samples.length,
    medianMs: median(perOperationMs),
    p95Ms: percentile(perOperationMs, 0.95),
    maxMs: Math.max(...perOperationMs),
    standardDeviationMs: standardDeviation(perOperationMs),
    bootstrapMedianCi95: deterministicBootstrapCi(perOperationMs),
    successCount: samples.reduce((sum, sample) => sum + sample.successCount, 0),
    errorCount: samples.reduce((sum, sample) => sum + sample.errorCount, 0),
    digestCount: samples.reduce((sum, sample) => sum + sample.digestCount, 0),
    digestBytes: samples.reduce((sum, sample) => sum + sample.digestBytes, 0),
    idbOperationCount: samples.reduce((sum, sample) => sum + sample.idbOperationCount, 0),
    prepareCount: samples.reduce((sum, sample) => sum + sample.prepareCount, 0),
    queueAgeP95Ms: percentile(
      samples.map((sample) => sample.queueAgeMaxMs),
      0.95,
    ),
    queueDepthMax: Math.max(...samples.map((sample) => sample.queueDepthMax)),
    // This is the largest after-sample JS heap snapshot, never a peak measurement.
    jsHeapSnapshotMaxBytes: maximumFinite(samples.map((sample) => sample.profiler?.jsHeapSnapshotBytes)),
    processPeakBytes: maximumFinite(samples.map((sample) => sample.profiler?.processPeakBytes)),
    wasmMemoryPeakBytes: maximumFinite(samples.map((sample) => sample.profiler?.wasmMemoryPeakBytes)),
  }
}

function assertComparableScenario(baseline, candidate) {
  if (baseline.key !== candidate.key) {
    throw new Error(`Benchmark comparison scenario mismatch: ${baseline.key} != ${candidate.key}`)
  }
  if (baseline.invocations.length < 3 || candidate.invocations.length < 3) {
    throw new Error(`${baseline.key} comparison requires three independent invocations`)
  }
  const baselineInvocationIndices = baseline.invocations.map(({ index }) => index)
  const candidateInvocationIndices = candidate.invocations.map(({ index }) => index)
  if (baselineInvocationIndices.some((index, position) => index !== position)) {
    throw new Error(`${baseline.key} comparison requires invocation indices aligned from zero`)
  }
  if (candidateInvocationIndices.some((index, position) => index !== position)) {
    throw new Error(`${candidate.key} comparison requires invocation indices aligned from zero`)
  }
}

function pairedImprovementPercent(baselineValues, candidateValues) {
  if (
    baselineValues.length !== candidateValues.length ||
    baselineValues.some((value) => !Number.isFinite(value) || value <= 0) ||
    candidateValues.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new Error('Benchmark comparison requires aligned positive baseline samples')
  }
  return baselineValues.map((baseline, index) => ((baseline - candidateValues[index]) / baseline) * 100)
}

const environmentComparisonFields = [
  'nodeVersion',
  'platform',
  'arch',
  'release',
  'cpu',
  'logicalCpuCount',
  'totalMemoryBytes',
  'sourceLockSha256',
]

function comparableEnvironment(environment) {
  return Object.fromEntries(environmentComparisonFields.map((field) => [field, environment[field]]))
}

function artifactComparisonIdentity(artifact) {
  if (artifact === null) {
    return null
  }
  return {
    target: artifact.target,
    version: artifact.version,
    modelDelivery: artifact.modelDelivery,
    fixture: artifact.fixture,
    model: artifact.model,
    wasm: artifact.wasm,
  }
}

function profilerPeakComparable(invocations) {
  const samples = invocations.flatMap(({ measuredSamples }) => measuredSamples)
  if (samples.length === 0) {
    return false
  }
  // jsHeapSnapshotBytes is deliberately excluded: measureUserAgentSpecificMemory
  // returns a point-in-time observation, not a sampled or process peak.
  return ['processPeakBytes', 'wasmMemoryPeakBytes'].every((field) =>
    samples.every((sample) => {
      const profiler = sample.profiler
      const measurementField = field === 'processPeakBytes' ? 'processMeasurementKind' : 'wasmMeasurementKind'
      return Number.isFinite(profiler?.[field]) && profiler?.[measurementField] === 'peak'
    }),
  )
}

function assertSameProfilerContract(baseline, candidate, key) {
  const baselineComparable = profilerPeakComparable(baseline.invocations)
  const candidateComparable = profilerPeakComparable(candidate.invocations)
  if (baselineComparable !== candidateComparable) {
    throw new Error(`${key} profiler peak availability differs between benchmark results`)
  }
  return baselineComparable && candidateComparable
}

export function compareBenchmarkResults(baseline, candidate) {
  validateBenchmarkResult(baseline)
  validateBenchmarkResult(candidate)
  if (!isDeepStrictEqual(comparableEnvironment(baseline.environment), comparableEnvironment(candidate.environment))) {
    throw new Error('Benchmark comparison requires matching platform, CPU, Node, and source-lock environment')
  }
  if (!isDeepStrictEqual(baseline.config, candidate.config)) {
    throw new Error('Benchmark comparison requires matching benchmark configuration')
  }
  const candidateByKey = new Map(candidate.scenarios.map((scenario) => [scenario.key, scenario]))
  if (candidateByKey.size !== baseline.scenarios.length || candidate.scenarios.length !== baseline.scenarios.length) {
    throw new Error('Benchmark comparison matrices do not match')
  }
  const comparisons = []
  for (const baselineScenario of baseline.scenarios) {
    const candidateScenario = candidateByKey.get(baselineScenario.key)
    if (!candidateScenario) {
      throw new Error(`Candidate is missing benchmark scenario ${baselineScenario.key}`)
    }
    assertComparableScenario(baselineScenario, candidateScenario)
    if (
      !isDeepStrictEqual(
        artifactComparisonIdentity(baselineScenario.artifact),
        artifactComparisonIdentity(candidateScenario.artifact),
      )
    ) {
      throw new Error(`${baselineScenario.key} artifact/model/WASM provenance differs between benchmark results`)
    }
    const baselineVersions = baselineScenario.invocations.map(({ browserVersion, driverVersion }) => [
      browserVersion,
      driverVersion,
    ])
    const candidateVersions = candidateScenario.invocations.map(({ browserVersion, driverVersion }) => [
      browserVersion,
      driverVersion,
    ])
    if (!isDeepStrictEqual(baselineVersions, candidateVersions)) {
      throw new Error(`${baselineScenario.key} browser or driver versions differ between benchmark results`)
    }
    const profilerComparable = assertSameProfilerContract(baselineScenario, candidateScenario, baselineScenario.key)
    const baselineMedian = baselineScenario.invocations.map((invocation) => invocation.summary.medianMs)
    const candidateMedian = candidateScenario.invocations.map((invocation) => invocation.summary.medianMs)
    const baselineP95 = baselineScenario.invocations.map((invocation) => invocation.summary.p95Ms)
    const candidateP95 = candidateScenario.invocations.map((invocation) => invocation.summary.p95Ms)
    const medianImprovements = pairedImprovementPercent(baselineMedian, candidateMedian)
    const p95Improvements = pairedImprovementPercent(baselineP95, candidateP95)
    const medianCi = deterministicBootstrapCi(medianImprovements)
    const p95Ci = deterministicBootstrapCi(p95Improvements)
    const peakMemoryRegressionPercent = profilerComparable
      ? ((Math.max(...candidateScenario.invocations.map(({ summary }) => summary.processPeakBytes)) -
          Math.max(...baselineScenario.invocations.map(({ summary }) => summary.processPeakBytes))) /
          Math.max(...baselineScenario.invocations.map(({ summary }) => summary.processPeakBytes))) *
        100
      : null
    const medianImprovementPercent = median(medianImprovements)
    const p95ImprovementPercent = median(p95Improvements)
    const acceptedLatencyImprovement =
      medianImprovementPercent >= 10 && p95ImprovementPercent >= 5 && medianCi.low > 0 && p95Ci.low > 0
    const nonRegressing =
      medianImprovementPercent >= -10 &&
      p95ImprovementPercent >= -10 &&
      (peakMemoryRegressionPercent === null || peakMemoryRegressionPercent <= 5)
    comparisons.push({
      key: baselineScenario.key,
      medianImprovementPercent,
      p95ImprovementPercent,
      medianImprovementCi95: medianCi,
      p95ImprovementCi95: p95Ci,
      peakMemoryRegressionPercent,
      profilerComparable,
      acceptedLatencyImprovement,
      memoryOptimizationEligible: profilerComparable,
      nonRegressing,
    })
  }
  return {
    schemaVersion: benchmarkSchemaVersion,
    baselineLabel: baseline.label,
    candidateLabel: candidate.label,
    comparisons,
    accepted: comparisons.every((comparison) => comparison.acceptedLatencyImprovement && comparison.nonRegressing),
  }
}

function escapeCsv(value) {
  if (value === null || value === undefined) {
    return ''
  }
  const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n\r]/u.test(rendered) ? `"${rendered.replaceAll('"', '""')}"` : rendered
}

export function renderBenchmarkCsv(result) {
  const columns = [
    'schemaVersion',
    'label',
    'scenarioKey',
    'browser',
    'browserVersion',
    'driverVersion',
    'imageBytes',
    'iterations',
    'pattern',
    'concurrency',
    'invocation',
    'phase',
    'sampleIndex',
    'durationMs',
    'perOperationMs',
    'successCount',
    'errorCount',
    'digestCount',
    'digestBytes',
    'idbOperationCount',
    'prepareRoundtripMs',
    'queueAgeMaxMs',
    'queueDepthMax',
    'jsHeapSnapshotBytes',
    'jsHeapMeasurementKind',
    'processPeakBytes',
    'processMeasurementKind',
    'wasmMemoryPeakBytes',
    'wasmMeasurementKind',
    'gcCount',
    'artifactArchiveSha256',
    'artifactModelSha256',
    'artifactWasmSha256',
  ]
  const rows = [columns]
  for (const scenario of result.scenarios) {
    for (const invocation of scenario.invocations) {
      for (const phase of ['warmupSamples', 'measuredSamples']) {
        const phaseName = phase === 'warmupSamples' ? 'warmup' : 'measured'
        for (const [sampleIndex, sample] of invocation[phase].entries()) {
          rows.push([
            result.schemaVersion,
            result.label,
            scenario.key,
            scenario.browser,
            invocation.browserVersion,
            invocation.driverVersion,
            scenario.imageBytes,
            scenario.iterations,
            scenario.pattern,
            scenario.concurrency,
            invocation.index,
            phaseName,
            sampleIndex,
            sample.durationMs,
            sample.perOperationMs,
            sample.successCount,
            sample.errorCount,
            sample.digestCount,
            sample.digestBytes,
            sample.idbOperationCount,
            sample.prepareRoundtripMs,
            sample.queueAgeMaxMs,
            sample.queueDepthMax,
            sample.profiler?.jsHeapSnapshotBytes ?? null,
            sample.profiler?.jsHeapMeasurementKind ?? null,
            sample.profiler?.processPeakBytes ?? null,
            sample.profiler?.processMeasurementKind ?? null,
            sample.profiler?.wasmMemoryPeakBytes ?? null,
            sample.profiler?.wasmMeasurementKind ?? null,
            sample.profiler?.gcCount ?? null,
            scenario.artifact?.archive?.sha256 ?? null,
            scenario.artifact?.model?.sha256 ?? null,
            scenario.artifact?.wasm?.sha256 ?? null,
          ])
        }
      }
    }
  }
  return `${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}\n`
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

export { transportWorkload }
