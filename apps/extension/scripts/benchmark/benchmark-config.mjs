import { assertSupportedBrowserVersion } from '../browser/browser-support.mjs'

export const transportWorkload = 'transport'
const supportedBrowsers = new Set(['chromium', 'firefox'])
const supportedPatterns = new Set(['sequential', 'burst'])
const supportedMatrixProfiles = new Set(['representative', 'exhaustive', 'custom'])

export const benchmarkSchemaVersion = 2
export const benchmarkWorkload = transportWorkload

export const requiredBenchmarkDefaults = Object.freeze({
  workload: transportWorkload,
  browsers: Object.freeze(['chromium', 'firefox']),
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
  if (new Set(values).size !== values.length) throw new Error(`Benchmark ${label} must be unique`)
}

function assertPositiveIntegers(values, label) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new Error(`Invalid benchmark ${label}: ${JSON.stringify(values)}`)
  }
  if (new Set(values).size !== values.length) throw new Error(`Benchmark ${label} must be unique`)
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
  if (!config || typeof config !== 'object') throw new Error('Benchmark config must be an object')
  if (config.workload !== transportWorkload) throw new Error('Only the transport benchmark workload is supported')
  if ('modes' in config || 'caches' in config)
    throw new Error('Transport benchmarks do not support extension mode or cache dimensions')
  assertUniqueAllowed(config.browsers, supportedBrowsers, 'browsers')
  assertUniqueAllowed(config.patterns, supportedPatterns, 'patterns')
  assertPositiveIntegers(config.imageBytes, 'image byte sizes')
  assertPositiveIntegers(config.iterations, 'iteration counts')
  if (!supportedMatrixProfiles.has(config.matrixProfile))
    throw new Error(`Invalid benchmark matrix profile: ${config.matrixProfile}`)
  if (
    config.matrixProfile === 'exhaustive' &&
    !sameNumberList(config.imageBytes, requiredBenchmarkDefaults.exhaustiveImageBytes)
  ) {
    throw new Error('The exhaustive benchmark profile must include all configured image sizes')
  }
  if (!Number.isSafeInteger(config.burstConcurrency) || config.burstConcurrency !== 6)
    throw new Error('Benchmark burst concurrency must remain 6')
  const allowReducedSampling = options.allowReducedSampling === true
  const minimumInvocations = allowReducedSampling ? 1 : requiredBenchmarkDefaults.invocations
  const minimumWarmups = allowReducedSampling ? 0 : requiredBenchmarkDefaults.warmups
  const minimumSamples = allowReducedSampling ? 1 : requiredBenchmarkDefaults.samples
  if (!Number.isSafeInteger(config.invocations) || config.invocations < minimumInvocations)
    throw new Error(`Benchmark requires at least ${minimumInvocations} independent invocations`)
  if (!Number.isSafeInteger(config.warmups) || config.warmups < minimumWarmups)
    throw new Error(`Benchmark requires at least ${minimumWarmups} warmups per invocation`)
  if (!Number.isSafeInteger(config.samples) || config.samples < minimumSamples)
    throw new Error(`Benchmark requires at least ${minimumSamples} measured samples per invocation`)
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

export {
  assertSupportedBrowserVersion,
  supportedBrowsers,
  supportedPatterns,
  assertUniqueAllowed,
  assertPositiveIntegers,
}
