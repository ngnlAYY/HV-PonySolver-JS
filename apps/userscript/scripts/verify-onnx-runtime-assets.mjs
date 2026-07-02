import { resolve } from 'node:path'
import {
  onnxRuntimeAssetIntegrityMatches,
  readFirstExistingOnnxRuntimeAssetStats,
  readOnnxRuntimeAssetsManifest,
  resolveInstalledOnnxRuntimePackageAssetPathCandidates,
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
  const verifiedAssets = []
  for (const asset of [manifest.scriptAsset, ...manifest.wasmAssets]) {
    const assetPaths = resolveInstalledOnnxRuntimePackageAssetPathCandidates(manifest, asset, repoRoot)
    const { stats: actual } = await readFirstExistingOnnxRuntimeAssetStats(assetPaths)
    if (!onnxRuntimeAssetIntegrityMatches(actual, asset)) {
      writeError(`ONNX Runtime asset integrity mismatch: ${asset.filename}`)
      writeError(`Expected: byteLength: ${asset.byteLength}, sha256: ${asset.sha256}`)
      writeError(`Actual: byteLength: ${actual.byteLength}, sha256: ${actual.sha256}`)
      process.exitCode = 1
      return
    }
    verifiedAssets.push(`${asset.filename} byteLength=${actual.byteLength}, sha256=${actual.sha256}`)
  }

  writeOutput(`ONNX Runtime assets verified: ${verifiedAssets.join('; ')}`)
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
