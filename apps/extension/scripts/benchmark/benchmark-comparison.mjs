import { isDeepStrictEqual } from 'node:util'

import { benchmarkSchemaVersion } from './benchmark-config.mjs'
import { validateBenchmarkResult } from './benchmark-result.mjs'
import { deterministicBootstrapCi, median } from './benchmark-statistics.mjs'

function assertComparableScenario(baseline, candidate) {
  if (baseline.key !== candidate.key)
    throw new Error(`Benchmark comparison scenario mismatch: ${baseline.key} != ${candidate.key}`)
  if (baseline.invocations.length < 3 || candidate.invocations.length < 3)
    throw new Error(`${baseline.key} comparison requires three independent invocations`)
  const baselineInvocationIndices = baseline.invocations.map(({ index }) => index)
  const candidateInvocationIndices = candidate.invocations.map(({ index }) => index)
  if (baselineInvocationIndices.some((index, position) => index !== position))
    throw new Error(`${baseline.key} comparison requires invocation indices aligned from zero`)
  if (candidateInvocationIndices.some((index, position) => index !== position))
    throw new Error(`${candidate.key} comparison requires invocation indices aligned from zero`)
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
function profilerPeakComparable(invocations) {
  const samples = invocations.flatMap(({ measuredSamples }) => measuredSamples)
  if (samples.length === 0) return false
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
  if (baselineComparable !== candidateComparable)
    throw new Error(`${key} profiler peak availability differs between benchmark results`)
  return baselineComparable && candidateComparable
}

export function compareBenchmarkResults(baseline, candidate) {
  validateBenchmarkResult(baseline)
  validateBenchmarkResult(candidate)
  if (!isDeepStrictEqual(comparableEnvironment(baseline.environment), comparableEnvironment(candidate.environment)))
    throw new Error('Benchmark comparison requires matching platform, CPU, Node, and source-lock environment')
  if (!isDeepStrictEqual(baseline.config, candidate.config))
    throw new Error('Benchmark comparison requires matching benchmark configuration')
  const candidateByKey = new Map(candidate.scenarios.map((scenario) => [scenario.key, scenario]))
  if (candidateByKey.size !== baseline.scenarios.length || candidate.scenarios.length !== baseline.scenarios.length)
    throw new Error('Benchmark comparison matrices do not match')
  const comparisons = []
  for (const baselineScenario of baseline.scenarios) {
    const candidateScenario = candidateByKey.get(baselineScenario.key)
    if (!candidateScenario) throw new Error(`Candidate is missing benchmark scenario ${baselineScenario.key}`)
    assertComparableScenario(baselineScenario, candidateScenario)
    if (
      !isDeepStrictEqual(
        artifactComparisonIdentity(baselineScenario.artifact),
        artifactComparisonIdentity(candidateScenario.artifact),
      )
    )
      throw new Error(`${baselineScenario.key} artifact/model/WASM provenance differs between benchmark results`)
    const baselineVersions = baselineScenario.invocations.map(({ browserVersion, driverVersion }) => [
      browserVersion,
      driverVersion,
    ])
    const candidateVersions = candidateScenario.invocations.map(({ browserVersion, driverVersion }) => [
      browserVersion,
      driverVersion,
    ])
    if (!isDeepStrictEqual(baselineVersions, candidateVersions))
      throw new Error(`${baselineScenario.key} browser or driver versions differ between benchmark results`)
    const profilerComparable = assertSameProfilerContract(baselineScenario, candidateScenario, baselineScenario.key)
    const medianImprovements = pairedImprovementPercent(
      baselineScenario.invocations.map(({ summary }) => summary.medianMs),
      candidateScenario.invocations.map(({ summary }) => summary.medianMs),
    )
    const p95Improvements = pairedImprovementPercent(
      baselineScenario.invocations.map(({ summary }) => summary.p95Ms),
      candidateScenario.invocations.map(({ summary }) => summary.p95Ms),
    )
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
