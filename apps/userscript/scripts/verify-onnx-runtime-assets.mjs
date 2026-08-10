import { resolve } from 'node:path'
import {
  assetIntegrityMatches,
  readAssetStats,
  readOnnxRuntimeAssetsManifest,
  resolveRuntimeBundlePath,
} from './onnx-runtime-assets.mjs'

async function verifyAsset(filePath, expected, label) {
  const actual = await readAssetStats(filePath)
  if (!assetIntegrityMatches(actual, expected)) {
    throw new Error(
      `${label} integrity mismatch: expected byteLength=${expected.byteLength} sha256=${expected.sha256}; ` +
        `actual byteLength=${actual.byteLength} sha256=${actual.sha256}`,
    )
  }
  return `${label} byteLength=${actual.byteLength} sha256=${actual.sha256}`
}

export async function runCli(repoRoot, env = process.env) {
  const manifest = await readOnnxRuntimeAssetsManifest(repoRoot)
  const verified = [
    await verifyAsset(resolveRuntimeBundlePath(manifest, repoRoot), manifest.bundleAsset, 'runtime bundle'),
  ]
  if (env.ORT_RUNTIME_WASM_FILE) {
    verified.push(await verifyAsset(resolve(env.ORT_RUNTIME_WASM_FILE), manifest.wasmAsset, 'runtime WASM'))
  }
  process.stdout.write(`ONNX Runtime assets verified: ${verified.join('; ')}\n`)
}

function resolveRepoRoot(args) {
  const index = args.indexOf('--repo-root')
  if (index === -1) return resolve(import.meta.dirname, '../../..')
  if (!args[index + 1]) throw new Error('--repo-root requires a path')
  return resolve(args[index + 1])
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    await runCli(resolveRepoRoot(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
