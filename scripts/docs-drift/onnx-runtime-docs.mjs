import { parseOnnxRuntimeAssetsManifest } from '../../apps/userscript/scripts/onnx-runtime-assets.mjs'

function checkOnnxRuntimeAssetsDocs(onnxRuntimeAssetsSource, userscriptPackageJson, readme) {
  const expectedAssets = parseOnnxRuntimeAssetsManifest(onnxRuntimeAssetsSource)
  const expectedPackageVersion = userscriptPackageJson.devDependencies?.[expectedAssets.packageName]
  const errors = []

  if (expectedPackageVersion !== expectedAssets.packageVersion) {
    errors.push(
      `apps/userscript/package.json devDependencies.${expectedAssets.packageName} must match ONNX_RUNTIME_ASSETS.packageVersion ${expectedAssets.packageVersion}`,
    )
  }

  const wasmAssetTerms = expectedAssets.wasmAssets.flatMap((asset) => [
    asset.path,
    asset.filename,
  ])

  const requiredTerms = [
    'ONNX_RUNTIME_ASSETS',
    expectedAssets.packageName,
    expectedAssets.packageVersion,
    expectedAssets.scriptAsset.path,
    expectedAssets.scriptAsset.filename,
    'scriptAsset.byteLength',
    'scriptAsset.sha256',
    'scriptAsset.maxByteLength',
    'wasmAssets',
    'wasmAssets.byteLength',
    'wasmAssets.sha256',
    ...wasmAssetTerms,
    'cdn.scriptUrl',
    'cdn.wasmPath',
    'verify-onnx-runtime-assets',
    'verify-onnx-runtime-cdn',
    'HV_PONY_SOLVER_BUNDLE_ONNX_RUNTIME',
    'HV_PONY_SOLVER_ONNX_RUNTIME_PATH',
    'ortWasmPath',
  ]
  for (const term of requiredTerms) {
    if (!readme.includes(term)) {
      errors.push(`README.md ONNX Runtime asset docs must mention ${term}`)
    }
  }

  return errors
}

export { checkOnnxRuntimeAssetsDocs }
