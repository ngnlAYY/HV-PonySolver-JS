import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'
import { ORT_RUNTIME_WASM_FILENAME, ORT_RUNTIME_WASM_INTEGRITY } from '@hv-pony-solver/shared/ort-runtime'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDirectory, '../..')
const repositoryRoot = path.resolve(extensionRoot, '../..')
const packageJson = JSON.parse(await readFile(path.join(extensionRoot, 'package.json'), 'utf8'))
const version = packageJson.version
const runtimeWasmFilename = ORT_RUNTIME_WASM_FILENAME
const runtimeWasmSha256 = ORT_RUNTIME_WASM_INTEGRITY.sha256
const runtimeWasmSource = path.join(repositoryRoot, 'other', runtimeWasmFilename)
const runtimeGlueSource = path.join(
  repositoryRoot,
  'apps',
  'userscript',
  'vendor',
  'onnxruntime',
  'ort.wasm.bundle.min.mjs',
)
const runtimeGlueSha256 = 'a63d4f08e70220c0f721fabfd4e4b958aa127334a19038b2732d07e919f32554'
const deterministicZipTimestamp = new Date('1980-01-01T00:00:00.000Z')
const dynamicRuntimeImport = 'import(/*webpackIgnore:true*/ /*@vite-ignore*/t)'
const disabledDynamicRuntimeImport =
  'Promise.reject(new Error("Dynamic ONNX runtime modules are disabled in the extension build"))'
const modelDeliveryModes = new Set(['remote', 'packaged'])
const extensionTargets = new Set(['chromium', 'firefox'])
const extensionImageResourcePattern = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/iu
const remoteModelOrigin = 'https://models.ngnl.host'
const remoteModelHost = `${remoteModelOrigin}/*`
const defaultOutputRoot = path.join(extensionRoot, 'dist')
const packagedModelIdentity = Object.freeze({
  filename: ORT_MODEL_FILENAME,
  byteLength: ORT_MODEL_INTEGRITY.byteLength,
  sha256: ORT_MODEL_INTEGRITY.sha256,
})
const packagedModelSource = path.join(repositoryRoot, 'model', ORT_MODEL_FILENAME)
const packagedModelIdentityModule = path.join(extensionRoot, 'src', 'host', 'packaged-model-identity.ts')
const fixtureIdentityNamespace = 'fixture-packaged-model-identity'
const fixtureDetectHookModule = path.join(extensionRoot, 'src', 'host', 'fixture-detect-hook.ts')
const fixtureDetectDelayModule = path.join(extensionRoot, 'src', 'host', 'fixture-detect-delay.ts')
const fixtureDetectDelayMarker = 'hv-pony-fixture-detect-delay'

const contentMatches = ['https://hentaiverse.org/*', 'https://alt.hentaiverse.org/*']
const contentExcludes = [
  'https://hentaiverse.org/battle_stats*',
  'https://alt.hentaiverse.org/battle_stats*',
  'https://hentaiverse.org/equip/*',
  'https://hentaiverse.org/isekai/equip/*',
]

export {
  extensionRoot,
  repositoryRoot,
  version,
  runtimeWasmFilename,
  runtimeWasmSha256,
  runtimeWasmSource,
  runtimeGlueSource,
  runtimeGlueSha256,
  deterministicZipTimestamp,
  dynamicRuntimeImport,
  disabledDynamicRuntimeImport,
  modelDeliveryModes,
  extensionTargets,
  extensionImageResourcePattern,
  remoteModelOrigin,
  remoteModelHost,
  defaultOutputRoot,
  packagedModelIdentity,
  packagedModelSource,
  packagedModelIdentityModule,
  fixtureIdentityNamespace,
  fixtureDetectHookModule,
  fixtureDetectDelayModule,
  fixtureDetectDelayMarker,
  contentMatches,
  contentExcludes,
}
