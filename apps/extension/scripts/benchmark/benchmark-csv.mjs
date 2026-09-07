function escapeCsv(value) {
  if (value === null || value === undefined) return ''
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
