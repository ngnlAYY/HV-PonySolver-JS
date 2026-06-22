import { resolve } from 'node:path'
import {
  onnxRuntimeAssetIntegrityMatches,
  readFirstExistingOnnxRuntimeAssetStats,
  readOnnxRuntimeAssetsManifest,
  resolveInstalledOnnxRuntimeAssetPathCandidates,
} from './onnx-runtime-assets.mjs'

if (isDirectRun()) {
  try {
    await runCli(resolveRepoRoot(process.argv.slice(2)))
  } catch (error) {
    writeError(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

async function runCli(repoRoot) {
  const manifest = await readOnnxRuntimeAssetsManifest(repoRoot)
  const assetPaths = resolveInstalledOnnxRuntimeAssetPathCandidates(manifest, repoRoot)
  const { stats: actual } = await readFirstExistingOnnxRuntimeAssetStats(assetPaths)
  const expected = manifest.scriptAsset

  if (!onnxRuntimeAssetIntegrityMatches(actual, expected)) {
    writeError('ONNX Runtime asset integrity mismatch')
    writeError(`Expected: byteLength: ${expected.byteLength}, sha256: ${expected.sha256}`)
    writeError(`Actual: byteLength: ${actual.byteLength}, sha256: ${actual.sha256}`)
    process.exitCode = 1
    return
  }

  writeOutput(
    `ONNX Runtime assets verified: ${expected.filename} byteLength=${actual.byteLength}, sha256=${actual.sha256}`,
  )
}

function isDirectRun() {
  return process.argv[1] ? resolve(process.argv[1]) === import.meta.filename : false
}

function resolveRepoRoot(args) {
  const repoRootIndex = args.indexOf('--repo-root')
  if (repoRootIndex === -1) {
    return resolve(import.meta.dirname, '../../..')
  }
  const repoRoot = args[repoRootIndex + 1]
  if (!repoRoot) {
    throw new Error('--repo-root requires a path')
  }
  return resolve(repoRoot)
}

function writeOutput(message) {
  process.stdout.write(`${message}\n`)
}

function writeError(message) {
  process.stderr.write(`${message}\n`)
}

export { resolveRepoRoot, runCli }
