const supportedBrowsers = new Set(['chromium', 'firefox'])
const supportedModes = new Set(['remote', 'packaged'])
const supportedCaches = new Set(['cold', 'warm'])
const supportedPatterns = new Set(['sequential', 'burst'])

export const benchmarkSchemaVersion = 1

export const requiredBenchmarkDefaults = Object.freeze({
  browsers: Object.freeze(['chromium', 'firefox']),
  modes: Object.freeze(['remote', 'packaged']),
  caches: Object.freeze(['cold', 'warm']),
  imageBytes: Object.freeze([1_024, 262_144, 2_097_152]),
  iterations: Object.freeze([100, 1_000]),
  patterns: Object.freeze(['sequential', 'burst']),
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
    !Array.isArray(values)
    || values.length === 0
    || values.some((value) => !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new Error(`Invalid benchmark ${label}: ${JSON.stringify(values)}`)
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`Benchmark ${label} must be unique`)
  }
}

export function validateBenchmarkConfig(config, options = {}) {
  assertUniqueAllowed(config.browsers, supportedBrowsers, 'browsers')
  assertUniqueAllowed(config.modes, supportedModes, 'modes')
  assertUniqueAllowed(config.caches, supportedCaches, 'caches')
  assertUniqueAllowed(config.patterns, supportedPatterns, 'patterns')
  assertPositiveIntegers(config.imageBytes, 'image byte sizes')
  assertPositiveIntegers(config.iterations, 'iteration counts')
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
  if (!Number.isSafeInteger(config.burstConcurrency) || config.burstConcurrency !== 6) {
    throw new Error('Benchmark burst concurrency must remain 6')
  }
  return config
}

export function scenarioKey(scenario) {
  return [
    scenario.browser,
    scenario.mode,
    scenario.cache,
    scenario.imageBytes,
    scenario.iterations,
    scenario.pattern,
    scenario.concurrency,
  ].join(':')
}

export function buildScenarioMatrix(config) {
  validateBenchmarkConfig(config, { allowReducedSampling: config.allowReducedSampling === true })
  const scenarios = []
  for (const browser of config.browsers) {
    for (const mode of config.modes) {
      for (const cache of config.caches) {
        for (const imageBytes of config.imageBytes) {
          for (const iterations of config.iterations) {
            for (const pattern of config.patterns) {
              const concurrency = pattern === 'burst' ? config.burstConcurrency : 1
              const scenario = { browser, mode, cache, imageBytes, iterations, pattern, concurrency }
              scenarios.push({ ...scenario, key: scenarioKey(scenario) })
            }
          }
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
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length
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

export function summarizeMeasuredSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('Cannot summarize an empty benchmark sample set')
  }
  const perOperationMs = samples.map((sample) => sample.perOperationMs)
  const peakMemoryValues = samples
    .map((sample) => sample.profiler?.jsHeapPeakBytes)
    .filter((value) => Number.isFinite(value))
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
    queueAgeP95Ms: percentile(samples.map((sample) => sample.queueAgeMaxMs), 0.95),
    queueDepthMax: Math.max(...samples.map((sample) => sample.queueDepthMax)),
    jsHeapPeakBytes: peakMemoryValues.length > 0 ? Math.max(...peakMemoryValues) : null,
  }
}

function assertComparableScenario(baseline, candidate) {
  if (baseline.key !== candidate.key) {
    throw new Error(`Benchmark comparison scenario mismatch: ${baseline.key} != ${candidate.key}`)
  }
  if (baseline.invocations.length < 3 || candidate.invocations.length < 3) {
    throw new Error(`${baseline.key} comparison requires three independent invocations`)
  }
}

function pairedImprovementPercent(baselineValues, candidateValues) {
  if (baselineValues.length !== candidateValues.length || baselineValues.some((value) => value <= 0)) {
    throw new Error('Benchmark comparison requires aligned positive baseline samples')
  }
  return baselineValues.map((baseline, index) => ((baseline - candidateValues[index]) / baseline) * 100)
}

export function compareBenchmarkResults(baseline, candidate) {
  validateBenchmarkResult(baseline)
  validateBenchmarkResult(candidate)
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
    const baselineMedian = baselineScenario.invocations.map((invocation) => invocation.summary.medianMs)
    const candidateMedian = candidateScenario.invocations.map((invocation) => invocation.summary.medianMs)
    const baselineP95 = baselineScenario.invocations.map((invocation) => invocation.summary.p95Ms)
    const candidateP95 = candidateScenario.invocations.map((invocation) => invocation.summary.p95Ms)
    const medianImprovements = pairedImprovementPercent(baselineMedian, candidateMedian)
    const p95Improvements = pairedImprovementPercent(baselineP95, candidateP95)
    const medianCi = deterministicBootstrapCi(medianImprovements)
    const p95Ci = deterministicBootstrapCi(p95Improvements)
    const profilerComparable = baselineScenario.invocations.every(({ summary }) => summary.jsHeapPeakBytes !== null)
      && candidateScenario.invocations.every(({ summary }) => summary.jsHeapPeakBytes !== null)
    const peakMemoryRegressionPercent = profilerComparable
      ? ((
          Math.max(...candidateScenario.invocations.map(({ summary }) => summary.jsHeapPeakBytes))
          - Math.max(...baselineScenario.invocations.map(({ summary }) => summary.jsHeapPeakBytes))
        ) / Math.max(...baselineScenario.invocations.map(({ summary }) => summary.jsHeapPeakBytes))) * 100
      : null
    const medianImprovementPercent = median(medianImprovements)
    const p95ImprovementPercent = median(p95Improvements)
    const acceptedLatencyImprovement = medianImprovementPercent >= 10
      && p95ImprovementPercent >= 5
      && medianCi.low > 0
      && p95Ci.low > 0
    const nonRegressing = medianImprovementPercent >= -10
      && p95ImprovementPercent >= -10
      && (peakMemoryRegressionPercent === null || peakMemoryRegressionPercent <= 5)
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
    'mode',
    'cache',
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
    'jsHeapPeakBytes',
    'processPeakBytes',
    'wasmMemoryPeakBytes',
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
            scenario.mode,
            scenario.cache,
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
            sample.profiler?.jsHeapPeakBytes ?? null,
            sample.profiler?.processPeakBytes ?? null,
            sample.profiler?.wasmMemoryPeakBytes ?? null,
            sample.profiler?.gcCount ?? null,
            scenario.artifact?.archiveSha256 ?? null,
            scenario.artifact?.modelSha256 ?? null,
            scenario.artifact?.wasmSha256 ?? null,
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

export function validateBenchmarkResult(result, options = {}) {
  if (result?.schemaVersion !== benchmarkSchemaVersion || !Array.isArray(result.scenarios)) {
    throw new Error('Unsupported benchmark result schema')
  }
  const expectedKeys = options.expectedConfig
    ? new Set(buildScenarioMatrix(options.expectedConfig).map(({ key }) => key))
    : null
  const seenKeys = new Set()
  for (const scenario of result.scenarios) {
    assertUniqueAllowed([scenario.browser], supportedBrowsers, 'result browser')
    assertUniqueAllowed([scenario.mode], supportedModes, 'result mode')
    assertUniqueAllowed([scenario.cache], supportedCaches, 'result cache')
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
    if (!Array.isArray(scenario.invocations) || scenario.invocations.length < 3) {
      throw new Error(`${scenario.key} has fewer than three independent invocations`)
    }
    for (const invocation of scenario.invocations) {
      if (invocation.warmupSamples.length < 3 || invocation.measuredSamples.length < 10) {
        throw new Error(`${scenario.key} invocation ${invocation.index} has insufficient samples`)
      }
      if (invocation.measuredSamples.some((sample) => sample.errorCount !== 0)) {
        throw new Error(`${scenario.key} invocation ${invocation.index} has correctness failures`)
      }
      for (const sample of [...invocation.warmupSamples, ...invocation.measuredSamples]) {
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
          assertFiniteNonNegative(sample[field], `${scenario.key} ${field}`)
        }
      }
    }
  }
  if (
    expectedKeys
    && (expectedKeys.size !== seenKeys.size || [...expectedKeys].some((key) => !seenKeys.has(key)))
  ) {
    throw new Error('Benchmark result does not contain the complete configured matrix')
  }
  return result
}
