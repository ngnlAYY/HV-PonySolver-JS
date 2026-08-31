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

  const requiredTerms = [
    'ONNX_RUNTIME_ASSETS',
    expectedAssets.packageName,
    expectedAssets.packageVersion,
    expectedAssets.sourceCommit,
    expectedAssets.emsdkVersion,
    expectedAssets.operatorConfigSha256,
    'externalFullRuntime',
    expectedAssets.externalFullRuntime.scriptUrl,
    expectedAssets.externalFullRuntime.wasmBaseUrl,
    expectedAssets.externalFullRuntime.wasmUrl,
    'externalFullRuntime.byteLength',
    'externalFullRuntime.sha256',
    'externalFullRuntime.maxByteLength',
    expectedAssets.externalFullRuntime.sha256,
    'externalFullRuntime.wasmByteLength',
    'externalFullRuntime.wasmSha256',
    'externalFullRuntime.wasmMaxByteLength',
    expectedAssets.externalFullRuntime.wasmSha256,
    'bundledMinimalRuntime',
    expectedAssets.bundleAsset.path,
    expectedAssets.bundleAsset.filename,
    'bundleAsset.byteLength',
    'bundleAsset.sha256',
    'bundleAsset.maxByteLength',
    expectedAssets.wasmAsset.filename,
    expectedAssets.wasmAsset.publicPath,
    expectedAssets.wasmAsset.url,
    expectedAssets.wasmAsset.objectKey,
    'wasmAsset.url',
    'wasmAsset.byteLength',
    'wasmAsset.sha256',
    'wasmAsset.maxByteLength',
    'verify:onnx-runtime',
    'build:onnx-runtime',
  ]
  for (const term of requiredTerms) {
    if (!readme.includes(term)) {
      errors.push(`README.md ONNX Runtime asset docs must mention ${term}`)
    }
  }

  return errors
}

function checkOnnxRuntimeSupplementalDocs(onnxRuntimeAssetsSource, onnxRuntimeDoc) {
  const expectedAssets = parseOnnxRuntimeAssetsManifest(onnxRuntimeAssetsSource)
  const requiredTerms = [
    'ONNX_RUNTIME_ASSETS',
    expectedAssets.packageVersion,
    expectedAssets.sourceCommit,
    expectedAssets.emsdkVersion,
    expectedAssets.externalFullRuntime.scriptUrl,
    expectedAssets.externalFullRuntime.wasmUrl,
    expectedAssets.externalFullRuntime.sha256,
    expectedAssets.externalFullRuntime.wasmSha256,
    expectedAssets.wasmAsset.publicPath,
    expectedAssets.wasmAsset.objectKey,
    expectedAssets.wasmAsset.sha256,
    'redirect: error',
    'wasmBinary',
    'build:onnx-runtime',
    'verify:onnx-runtime',
  ]

  return requiredTerms.flatMap((term) =>
    onnxRuntimeDoc.includes(term) ? [] : [`docs/onnx-runtime.md ONNX Runtime contract must mention ${term}`],
  )
}

export { checkOnnxRuntimeAssetsDocs, checkOnnxRuntimeSupplementalDocs }
