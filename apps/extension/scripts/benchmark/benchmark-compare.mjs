import { readFile, writeFile } from 'node:fs/promises'

import { compareBenchmarkResults } from './benchmark-contract.mjs'

const [baselinePath, candidatePath, outputPath] = process.argv.slice(2)
if (!baselinePath || !candidatePath) {
  throw new Error('Usage: benchmark-compare.mjs BASELINE_JSON CANDIDATE_JSON [OUTPUT_JSON]')
}
const [baseline, candidate] = await Promise.all([
  readFile(baselinePath, 'utf8').then(JSON.parse),
  readFile(candidatePath, 'utf8').then(JSON.parse),
])
const comparison = compareBenchmarkResults(baseline, candidate)
const rendered = `${JSON.stringify(comparison, null, 2)}\n`
if (outputPath) {
  await writeFile(outputPath, rendered)
} else {
  process.stdout.write(rendered)
}
if (!comparison.accepted) {
  process.exitCode = 2
}
