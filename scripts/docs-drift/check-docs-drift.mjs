import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseOnnxRuntimeAssetsManifest } from '../../apps/userscript/scripts/onnx-runtime-assets.mjs'
import { parseRepoRootArgs } from '../lib/cli.mjs'
import { isDirectRun } from '../lib/direct-run.mjs'
import { checkArchitectureGuardrails, checkUserscriptConfigDocs } from './architecture-docs.mjs'
import { checkModelManifestDocs } from './model-manifest-docs.mjs'
import {
  checkModelCacheStrategyDocs,
  checkModelWorkerDocs,
  checkModelWorkerOpsDocs,
  readModelWorkerHttpFacts,
} from './model-worker-docs.mjs'
import { checkOnnxRuntimeAssetsDocs, checkOnnxRuntimeSupplementalDocs } from './onnx-runtime-docs.mjs'
import { checkRootCheckCommand, checkCommandExamples } from './readme-commands.mjs'
import { COMMAND_DOCUMENTS } from './documentation-paths.mjs'
import { checkExtensionDocs } from './extension-docs.mjs'
import { parseModelManifest } from '../model/model-manifest.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDir, '../..')

if (isDirectRun(import.meta.url)) {
  try {
    const { repoRoot } = parseRepoRootArgs(process.argv.slice(2), defaultRepoRoot)
    const errors = await checkDocsDrift(repoRoot)
    if (errors.length > 0) {
      for (const error of errors) {
        process.stderr.write(`Docs drift: ${error}\n`)
      }
      process.exitCode = 1
    } else {
      process.stdout.write('Docs drift check passed\n')
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

function parseJson(text, relativePath) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid JSON in ${relativePath}`, { cause: error })
  }
}

async function checkDocsDrift(repoRoot = defaultRepoRoot, options = {}) {
  const readSource = options.readText ?? ((relativePath) => readText(repoRoot, relativePath))
  const readPackage = async (relativePath) => parseJson(await readSource(relativePath), relativePath)
  const [
    rootPackageJson,
    userscriptPackageJson,
    extensionPackageJson,
    modelWorkerPackageJson,
    browserCorePackageJson,
    sharedPackageJson,
    readme,
    commandsDoc,
    browserRuntimeDoc,
    architectureDoc,
    httpDoc,
    releaseDoc,
    extensionDoc,
    modelCacheStrategyDoc,
    modelWorkerOpsDoc,
    onnxRuntimeDoc,
    modelWorkerDeploymentWorkflow,
    browserSupportModule,
    inferenceConfigSource,
    onnxRuntimeAssetsSource,
    modelWorkerRequestRouterSource,
    modelWorkerAccessSource,
    modelWorkerResponseSource,
    modelSource,
    extensionPathsModule,
  ] = await Promise.all([
    readPackage('package.json'),
    readPackage('apps/userscript/package.json'),
    readPackage('apps/extension/package.json'),
    readPackage('apps/model-worker/package.json'),
    readPackage('packages/browser-core/package.json'),
    readPackage('packages/shared/package.json'),
    readSource('README.md'),
    readSource('docs/development/commands.md'),
    readSource('docs/architecture/browser-runtime.md'),
    readSource('docs/architecture/overview.md'),
    readSource('docs/reference/model-worker-http.md'),
    readSource('docs/development/releases.md'),
    readSource('docs/browser-extension.md'),
    readSource('docs/model-cache-strategy.md'),
    readSource('docs/model-worker-ops.md'),
    readSource('docs/onnx-runtime.md'),
    readSource('.github/workflows/deploy-cloudflare-model-worker.yml'),
    importBrowserSupport(repoRoot),
    readSource('packages/browser-core/src/inference/inference-config.ts'),
    readSource('apps/userscript/src/inference/onnx-runtime-assets.ts'),
    readSource('apps/model-worker/src/request-router.ts'),
    readSource('apps/model-worker/src/model-access.ts'),
    readSource('apps/model-worker/src/model-response.ts'),
    readSource('packages/shared/src/model.ts'),
    importExtensionPaths(repoRoot),
  ])
  const modelWorkerHttpFacts = readModelWorkerHttpFacts(
    modelWorkerRequestRouterSource,
    modelWorkerAccessSource,
    modelWorkerResponseSource,
    modelSource,
  )

  const runtimeAssets = parseOnnxRuntimeAssetsManifest(onnxRuntimeAssetsSource)
  const workspacePackages = [
    userscriptPackageJson,
    extensionPackageJson,
    modelWorkerPackageJson,
    browserCorePackageJson,
    sharedPackageJson,
  ]
  const commandErrors = await Promise.all(
    COMMAND_DOCUMENTS.map(async (path) =>
      checkCommandExamples(rootPackageJson, workspacePackages, await readSource(path), path),
    ),
  )

  return [
    ...commandErrors.flat(),
    ...checkRootCheckCommand(
      rootPackageJson,
      [userscriptPackageJson, extensionPackageJson, modelWorkerPackageJson, browserCorePackageJson, sharedPackageJson],
      commandsDoc,
    ),
    ...checkUserscriptConfigDocs(inferenceConfigSource, browserRuntimeDoc),
    ...modelWorkerHttpFacts.errors,
    ...checkModelManifestDocs(modelSource, onnxRuntimeDoc),
    ...checkOnnxRuntimeAssetsDocs(onnxRuntimeAssetsSource, userscriptPackageJson, onnxRuntimeDoc, runtimeAssets),
    ...checkOnnxRuntimeSupplementalDocs(onnxRuntimeAssetsSource, onnxRuntimeDoc, runtimeAssets),
    ...checkModelWorkerDocs(httpDoc, modelWorkerHttpFacts),
    ...checkModelCacheStrategyDocs(modelCacheStrategyDoc, modelWorkerHttpFacts),
    ...checkModelWorkerOpsDocs(modelWorkerOpsDoc, releaseDoc, modelWorkerDeploymentWorkflow),
    ...checkArchitectureGuardrails(architectureDoc),
    ...checkExtensionDocs(
      extensionPackageJson,
      browserSupportModule.browserSupport,
      readme,
      extensionDoc,
      extensionPathsModule.EXTENSION_PATHS,
    ),
  ]
}

async function readText(repoRoot, relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8')
}

async function importBrowserSupport(repoRoot) {
  const url = pathToFileURL(resolve(repoRoot, 'apps/extension/scripts/browser/browser-support.mjs'))
  url.searchParams.set('repoRoot', repoRoot)
  return import(url.href)
}

async function importExtensionPaths(repoRoot) {
  const url = pathToFileURL(resolve(repoRoot, 'apps/extension/src/platform/extension-paths.ts'))
  url.searchParams.set('repoRoot', repoRoot)
  return import(url.href)
}

export { checkDocsDrift, parseModelManifest, parseOnnxRuntimeAssetsManifest }
