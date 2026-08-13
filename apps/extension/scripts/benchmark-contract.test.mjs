import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  benchmarkSchemaVersion,
  buildScenarioMatrix,
  compareBenchmarkResults,
  deterministicBootstrapCi,
  median,
  percentile,
  renderBenchmarkCsv,
  requiredBenchmarkDefaults,
  scenarioKey,
  summarizeMeasuredSamples,
  validateBenchmarkConfig,
  validateBenchmarkResult,
} from './benchmark-contract.mjs'

function config(overrides = {}) {
  return {
    ...requiredBenchmarkDefaults,
    browsers: [...requiredBenchmarkDefaults.browsers],
    modes: [...requiredBenchmarkDefaults.modes],
    caches: [...requiredBenchmarkDefaults.caches],
    imageBytes: [...requiredBenchmarkDefaults.imageBytes],
    iterations: [...requiredBenchmarkDefaults.iterations],
    patterns: [...requiredBenchmarkDefaults.patterns],
    ...overrides,
  }
}

function sample(perOperationMs, profiler = null) {
  return {
    durationMs: perOperationMs * 100,
    perOperationMs,
    successCount: 100,
    errorCount: 0,
    digestCount: 1,
    digestBytes: 1_024,
    idbOperationCount: 2,
    prepareCount: 1,
    prepareRoundtripMs: 1,
    queueAgeMaxMs: 2,
    queueDepthMax: 100,
    profiler,
  }
}

describe('extension benchmark contract', () => {
  it('materializes the complete required 2x2x2x3x2x2 matrix with burst six', () => {
    const matrix = buildScenarioMatrix(config())
    assert.equal(matrix.length, 96)
    assert.deepEqual(new Set(matrix.map(({ concurrency }) => concurrency)), new Set([1, 6]))
    assert(matrix.some(({ imageBytes, iterations }) => imageBytes === 2_097_152 && iterations === 1_000))
    assert.equal(new Set(matrix.map(({ key }) => key)).size, matrix.length)
  })

  it('fails closed when statistical independence or sampling floors are weakened', () => {
    assert.throws(() => validateBenchmarkConfig(config({ invocations: 2 })), /3 independent/u)
    assert.throws(() => validateBenchmarkConfig(config({ warmups: 2 })), /3 warmups/u)
    assert.throws(() => validateBenchmarkConfig(config({ samples: 9 })), /10 measured/u)
    assert.throws(() => validateBenchmarkConfig(config({ burstConcurrency: 5 })), /remain 6/u)
  })

  it('calculates deterministic distribution and bootstrap statistics', () => {
    assert.equal(median([9, 1, 5, 3]), 4)
    assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5)
    assert.deepEqual(
      deterministicBootstrapCi([1, 2, 3, 4, 5], { resamples: 100, seed: 7 }),
      deterministicBootstrapCi([1, 2, 3, 4, 5], { resamples: 100, seed: 7 }),
    )
    const summary = summarizeMeasuredSamples([
      sample(1, { jsHeapPeakBytes: 10 }),
      sample(2, { jsHeapPeakBytes: 20 }),
      sample(3),
    ])
    assert.equal(summary.medianMs, 2)
    assert.equal(summary.p95Ms, 3)
    assert.equal(summary.jsHeapPeakBytes, 20)
  })

  it('validates full evidence and renders explicit null profiler fields in CSV', () => {
    const scenario = {
      browser: 'firefox',
      mode: 'packaged',
      cache: 'warm',
      imageBytes: 1_024,
      iterations: 100,
      pattern: 'burst',
      concurrency: 6,
    }
    const invocation = (index) => ({
      index,
      browserVersion: '153.0',
      warmupSamples: Array.from({ length: 3 }, () => sample(1)),
      measuredSamples: Array.from({ length: 10 }, () => sample(1)),
    })
    const result = {
      schemaVersion: benchmarkSchemaVersion,
      label: 'baseline',
      scenarios: [{ ...scenario, key: scenarioKey(scenario), artifact: null, invocations: [0, 1, 2].map(invocation) }],
    }
    assert.equal(validateBenchmarkResult(result), result)
    const csv = renderBenchmarkCsv(result)
    assert.match(csv, /processPeakBytes,wasmMemoryPeakBytes,gcCount/u)
    assert.match(csv, /firefox,153\.0,packaged,warm/u)
    assert.throws(
      () => validateBenchmarkResult({ ...result, scenarios: [{ ...result.scenarios[0], invocations: [invocation(0)] }] }),
      /fewer than three/u,
    )
    assert.throws(
      () => validateBenchmarkResult({ ...result, scenarios: [{ ...result.scenarios[0], mode: 'invented' }] }),
      /Invalid benchmark result mode/u,
    )
    assert.throws(
      () => validateBenchmarkResult({
        ...result,
        scenarios: [result.scenarios[0], result.scenarios[0]],
      }),
      /Duplicate benchmark scenario/u,
    )
    const negative = globalThis.structuredClone(result)
    negative.scenarios[0].invocations[0].measuredSamples[0].durationMs = -1
    assert.throws(() => validateBenchmarkResult(negative), /finite non-negative/u)
  })

  it('accepts only aligned statistically positive comparisons and keeps null memory explicit', () => {
    const scenario = {
      browser: 'firefox',
      mode: 'remote',
      cache: 'warm',
      imageBytes: 262_144,
      iterations: 1_000,
      pattern: 'sequential',
      concurrency: 1,
    }
    const makeResult = (label, values) => ({
      schemaVersion: benchmarkSchemaVersion,
      label,
      scenarios: [{
        ...scenario,
        key: scenarioKey(scenario),
        artifact: null,
        invocations: values.map((value, index) => ({
          index,
          browserVersion: '153.0',
          warmupSamples: Array.from({ length: 3 }, () => sample(value)),
          measuredSamples: Array.from({ length: 10 }, () => sample(value)),
          summary: summarizeMeasuredSamples(Array.from({ length: 10 }, () => sample(value))),
        })),
      }],
    })
    const comparison = compareBenchmarkResults(makeResult('baseline', [10, 11, 12]), makeResult('candidate', [8, 8.8, 9.6]))
    assert.equal(comparison.accepted, true)
    assert.equal(comparison.comparisons[0].profilerComparable, false)
    assert.equal(comparison.comparisons[0].memoryOptimizationEligible, false)
    assert.equal(comparison.comparisons[0].peakMemoryRegressionPercent, null)
  })
})
