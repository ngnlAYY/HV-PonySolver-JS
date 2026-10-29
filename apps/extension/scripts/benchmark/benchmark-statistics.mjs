export function median(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('Cannot calculate a median without samples')
  return medianOfSorted([...values].sort((left, right) => left - right))
}

function medianOfSorted(sorted) {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('Cannot calculate a percentile without samples')
  if (!Number.isFinite(percentileValue) || percentileValue < 0 || percentileValue > 1)
    throw new Error(`Invalid percentile: ${percentileValue}`)
  return percentileOfSorted(
    [...values].sort((left, right) => left - right),
    percentileValue,
  )
}

function percentileOfSorted(sorted, percentileValue) {
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)]
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
  if (!Array.isArray(values) || values.length < 2)
    throw new Error('Bootstrap input requires at least two finite samples')
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error('Bootstrap input requires at least two finite samples')
  }
  const resamples = options.resamples ?? 2_000
  const seed = options.seed ?? 0x4856_5053
  const statistic = options.statistic ?? median
  if (!Number.isSafeInteger(resamples) || resamples < 100) throw new Error('Bootstrap requires at least 100 resamples')
  const random = seededRandom(seed)
  const estimates = []
  // Only the built-in median can reuse its scratch array; custom statistics may retain samples.
  const medianSample = statistic === median ? new Array(values.length) : null
  for (let sampleIndex = 0; sampleIndex < resamples; sampleIndex += 1) {
    const sample = medianSample ?? new Array(values.length)
    for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1)
      sample[valueIndex] = values[Math.floor(random() * values.length)]
    estimates.push(medianSample ? medianOfSorted(sample.sort((left, right) => left - right)) : statistic(sample))
  }
  estimates.sort((left, right) => left - right)
  return { low: percentileOfSorted(estimates, 0.025), high: percentileOfSorted(estimates, 0.975), resamples, seed }
}

function maximumFinite(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value))
  return finiteValues.length > 0 ? Math.max(...finiteValues) : null
}

export function summarizeMeasuredSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('Cannot summarize an empty benchmark sample set')
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
    jsHeapSnapshotMaxBytes: maximumFinite(samples.map((sample) => sample.profiler?.jsHeapSnapshotBytes)),
    processPeakBytes: maximumFinite(samples.map((sample) => sample.profiler?.processPeakBytes)),
    wasmMemoryPeakBytes: maximumFinite(samples.map((sample) => sample.profiler?.wasmMemoryPeakBytes)),
  }
}
