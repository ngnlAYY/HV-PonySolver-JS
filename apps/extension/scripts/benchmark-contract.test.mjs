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
  summarizeMeasuredSamples,
  validateBenchmarkConfig,
  validateBenchmarkResult,
} from './benchmark-contract.mjs'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const workloadContract =
  'browser Blob copy plus full-buffer digest only; extension transport, prepare, detect, mode, and cache are not measured'
const profilerContract =
  'jsHeapSnapshotBytes is an after-sample snapshot, not a peak; process and WASM peak fields are null when unsupported'

function config(overrides = {}) {
  return {
    ...requiredBenchmarkDefaults,
    browsers: ['firefox'],
    imageBytes: [1_024],
    exhaustiveImageBytes: [...requiredBenchmarkDefaults.exhaustiveImageBytes],
    iterations: [100],
    patterns: ['sequential'],
    matrixProfile: 'custom',
    ...overrides,
  }
}

function unsupportedProfiler() {
  return {
    available: false,
    jsHeapSnapshotBytes: null,
    jsHeapMeasurementKind: 'unsupported',
    processPeakBytes: null,
    processMeasurementKind: 'unsupported',
    wasmMemoryPeakBytes: null,
    wasmMeasurementKind: 'unsupported',
    gcCount: null,
  }
}

function snapshotProfiler(bytes) {
  return {
    available: true,
    jsHeapSnapshotBytes: bytes,
    jsHeapMeasurementKind: 'snapshot',
    processPeakBytes: null,
    processMeasurementKind: 'unsupported',
    wasmMemoryPeakBytes: null,
    wasmMeasurementKind: 'unsupported',
    gcCount: null,
  }
}

function sample(scenario, perOperationMs, profiler = unsupportedProfiler()) {
  return {
    durationMs: perOperationMs * scenario.iterations,
    perOperationMs,
    successCount: scenario.iterations,
    errorCount: 0,
    digestCount: scenario.iterations,
    digestBytes: scenario.imageBytes * scenario.iterations,
    idbOperationCount: 0,
    prepareCount: 0,
    prepareRoundtripMs: null,
    queueAgeMaxMs: 2,
    queueDepthMax: scenario.concurrency,
    profiler,
  }
}

function environment(overrides = {}) {
  return {
    nodeVersion: 'v24.0.0',
    platform: 'linux',
    arch: 'x64',
    release: '6.1.0-test',
    cpu: 'Test CPU',
    logicalCpuCount: 8,
    totalMemoryBytes: 16_000_000_000,
    sourceLockSha256: 'a'.repeat(64),
    gitSha: null,
    ...overrides,
  }
}

function result(label, values = [10, 11, 12], overrides = {}) {
  const benchmarkConfig = config(overrides.config)
  const scenarios = buildScenarioMatrix(benchmarkConfig)
  return {
    schemaVersion: benchmarkSchemaVersion,
    label,
    createdAt: '2026-08-18T00:00:00.000Z',
    environment: environment(overrides.environment),
    config: {
      ...benchmarkConfig,
      browserReuse: true,
      browserReuseContract: 'one browser process per browser and one fresh browser context per invocation',
      workloadContract,
      profilerAvailabilityContract: profilerContract,
    },
    scenarios: scenarios.map((scenario) => ({
      ...scenario,
      artifact: null,
      invocations: values.map((value, index) => {
        const measuredSamples = Array.from({ length: benchmarkConfig.samples }, () => sample(scenario, value))
        return {
          index,
          browserVersion: '153.0',
          driverVersion: null,
          warmupSamples: Array.from({ length: benchmarkConfig.warmups }, () => sample(scenario, value)),
          measuredSamples,
          summary: summarizeMeasuredSamples(measuredSamples),
        }
      }),
    })),
  }
}

describe('extension transport benchmark contract', () => {
  it('uses a representative matrix by default and keeps exhaustive opt-in explicit', () => {
    const representative = {
      ...requiredBenchmarkDefaults,
      browsers: [...requiredBenchmarkDefaults.browsers],
      imageBytes: [...requiredBenchmarkDefaults.imageBytes],
      iterations: [...requiredBenchmarkDefaults.iterations],
      patterns: [...requiredBenchmarkDefaults.patterns],
      matrixProfile: 'representative',
    }
    const exhaustive = {
      ...representative,
      imageBytes: [...requiredBenchmarkDefaults.exhaustiveImageBytes],
      matrixProfile: 'exhaustive',
    }
    assert.equal(buildScenarioMatrix(representative).length, 16)
    assert.equal(buildScenarioMatrix(exhaustive).length, 24)
    assert.deepEqual(
      new Set(buildScenarioMatrix(representative).map(({ concurrency }) => concurrency)),
      new Set([1, 6]),
    )
    assert(
      buildScenarioMatrix(exhaustive).some(
        ({ imageBytes, iterations }) => imageBytes === 2_097_152 && iterations === 1_000,
      ),
    )
    assert.equal('modes' in representative, false)
    assert.equal('caches' in representative, false)
  })

  it('rejects the old extension mode/cache dimensions and weakened sampling floors', () => {
    assert.throws(() => validateBenchmarkConfig(config({ modes: ['remote'] })), /mode or cache dimensions/u)
    assert.throws(() => validateBenchmarkConfig(config({ workload: 'inference' })), /transport benchmark workload/u)
    assert.throws(() => validateBenchmarkConfig(config({ invocations: 2 })), /3 independent/u)
    assert.throws(() => validateBenchmarkConfig(config({ warmups: 2 })), /3 warmups/u)
    assert.throws(() => validateBenchmarkConfig(config({ samples: 9 })), /10 measured/u)
    assert.throws(() => validateBenchmarkConfig(config({ burstConcurrency: 5 })), /remain 6/u)
    assert.throws(
      () => validateBenchmarkConfig(config({ matrixProfile: 'exhaustive', imageBytes: [1_024] })),
      /exhaustive benchmark profile/u,
    )
  })

  it('calculates deterministic distribution and names the heap observation as a snapshot', () => {
    assert.equal(median([9, 1, 5, 3]), 4)
    assert.equal(percentile([1, 2, 3, 4, 5], 0.95), 5)
    assert.deepEqual(
      deterministicBootstrapCi([1, 2, 3, 4, 5], { resamples: 100, seed: 7 }),
      deterministicBootstrapCi([1, 2, 3, 4, 5], { resamples: 100, seed: 7 }),
    )
    const scenario = buildScenarioMatrix(config())[0]
    const summary = summarizeMeasuredSamples([
      sample(scenario, 1, snapshotProfiler(10)),
      sample(scenario, 2, snapshotProfiler(20)),
      sample(scenario, 3),
    ])
    assert.equal(summary.medianMs, 2)
    assert.equal(summary.p95Ms, 3)
    assert.equal(summary.jsHeapSnapshotMaxBytes, 20)
    assert.equal('jsHeapPeakBytes' in summary, false)
  })

  it('validates environment, raw samples, recalculated summary, and profiler fields', () => {
    const valid = result('baseline')
    assert.equal(validateBenchmarkResult(valid), valid)
    const csv = renderBenchmarkCsv(valid)
    assert.match(csv, /jsHeapSnapshotBytes,jsHeapMeasurementKind,processPeakBytes/u)
    assert.doesNotMatch(csv, /jsHeapPeakBytes/u)

    const forgedSummary = clone(valid)
    forgedSummary.scenarios[0].invocations[0].summary.medianMs = 0.001
    assert.throws(() => validateBenchmarkResult(forgedSummary), /summary does not match raw measuredSamples/u)

    const retiredProfilerField = clone(valid)
    retiredProfilerField.scenarios[0].invocations[0].measuredSamples[0].profiler = {
      ...unsupportedProfiler(),
      jsHeapPeakBytes: 123,
    }
    assert.throws(() => validateBenchmarkResult(retiredProfilerField), /retired jsHeapPeakBytes/u)

    const unsupportedSchema = clone(valid)
    unsupportedSchema.schemaVersion = 1
    assert.throws(() => validateBenchmarkResult(unsupportedSchema), /Unsupported benchmark result schema 1.*schema 2/u)

    const badEnvironment = clone(valid)
    badEnvironment.environment.cpu = ''
    assert.throws(() => validateBenchmarkResult(badEnvironment), /environment cpu/u)

    const badReuseContract = clone(valid)
    badReuseContract.config.browserReuseContract = 'one browser process total'
    assert.throws(() => validateBenchmarkResult(badReuseContract), /invalid browser reuse contract/u)

    const negativeSnapshot = clone(valid)
    const negativeInvocation = negativeSnapshot.scenarios[0].invocations[0]
    negativeInvocation.measuredSamples[0].profiler = snapshotProfiler(-1)
    negativeInvocation.summary = summarizeMeasuredSamples(negativeInvocation.measuredSamples)
    assert.throws(() => validateBenchmarkResult(negativeSnapshot), /available JS heap profiler/u)
  })

  it('compares only aligned, same-environment evidence and never gates on heap snapshots', () => {
    const baseline = result('baseline', [10, 11, 12])
    const candidate = result('candidate', [8, 8.8, 9.6])
    const comparison = compareBenchmarkResults(baseline, candidate)
    assert.equal(comparison.accepted, true)
    assert.equal(comparison.comparisons[0].profilerComparable, false)
    assert.equal(comparison.comparisons[0].memoryOptimizationEligible, false)
    assert.equal(comparison.comparisons[0].peakMemoryRegressionPercent, null)

    const browserMismatch = result('candidate', [8, 8.8, 9.6])
    browserMismatch.scenarios[0].invocations.forEach((invocation) => {
      invocation.browserVersion = '154.0'
    })
    assert.throws(() => compareBenchmarkResults(baseline, browserMismatch), /browser or driver versions differ/u)

    const platformMismatch = result('candidate', [8, 8.8, 9.6], { environment: { platform: 'darwin' } })
    assert.throws(() => compareBenchmarkResults(baseline, platformMismatch), /platform, CPU, Node/u)
  })

  it('rejects mismatched artifact provenance even though the workload is transport-only', () => {
    const artifact = {
      target: 'firefox',
      version: '9.9.9',
      modelDelivery: 'remote',
      fixture: false,
      archive: { archiveName: 'extension.zip', byteLength: 1, sha256: 'b'.repeat(64) },
      model: null,
      wasm: { path: 'runtime/runtime.wasm', byteLength: 1, sha256: 'c'.repeat(64) },
    }
    const baseline = result('baseline')
    baseline.scenarios.forEach((scenario) => {
      scenario.artifact = artifact
    })
    const candidate = clone(baseline)
    candidate.label = 'candidate'
    candidate.scenarios.forEach((scenario) => {
      scenario.artifact = { ...artifact, wasm: { ...artifact.wasm, sha256: 'd'.repeat(64) } }
    })
    assert.throws(() => compareBenchmarkResults(baseline, candidate), /artifact\/model\/WASM provenance/u)
  })
})
