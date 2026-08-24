import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseOnnxRuntimeAssetsManifest } from '../apps/userscript/scripts/onnx-runtime-assets.mjs'
import { parseRepoRootArgs } from './lib/cli.mjs'
import { isDirectRun } from './lib/direct-run.mjs'
import { checkArchitectureGuardrails, checkUserscriptConfigDocs } from './docs-drift/architecture-docs.mjs'
import { checkModelManifestDocs } from './docs-drift/model-manifest-docs.mjs'
import { checkModelWorkerDocs, readModelWorkerHttpFacts } from './docs-drift/model-worker-docs.mjs'
import { checkOnnxRuntimeAssetsDocs } from './docs-drift/onnx-runtime-docs.mjs'
import { checkRootCheckCommand } from './docs-drift/readme-commands.mjs'
import { checkExtensionDocs } from './docs-drift/extension-docs.mjs'
import { parseModelManifest } from './model-manifest.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDir, '..')

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

async function checkDocsDrift(repoRoot = defaultRepoRoot) {
  const [
    rootPackageJson,
    userscriptPackageJson,
    extensionPackageJson,
    readme,
    extensionDoc,
    browserSupportModule,
    inferenceConfigSource,
    onnxRuntimeAssetsSource,
    modelWorkerRequestRouterSource,
    modelWorkerAccessSource,
    modelWorkerResponseSource,
    modelSource,
  ] = await Promise.all([
    readJson(repoRoot, 'package.json'),
    readJson(repoRoot, 'apps/userscript/package.json'),
    readJson(repoRoot, 'apps/extension/package.json'),
    readText(repoRoot, 'README.md'),
    readText(repoRoot, 'docs/browser-extension.md'),
    importBrowserSupport(repoRoot),
    readText(repoRoot, 'packages/browser-core/src/inference/inference-config.ts'),
    readText(repoRoot, 'apps/userscript/src/inference/onnx-runtime-assets.ts'),
    readText(repoRoot, 'apps/model-worker/src/request-router.ts'),
    readText(repoRoot, 'apps/model-worker/src/model-access.ts'),
    readText(repoRoot, 'apps/model-worker/src/model-response.ts'),
    readText(repoRoot, 'packages/shared/src/model.ts'),
  ])
  const modelWorkerHttpFacts = readModelWorkerHttpFacts(
    modelWorkerRequestRouterSource,
    modelWorkerAccessSource,
    modelWorkerResponseSource,
  )

  return [
    ...checkRootCheckCommand(rootPackageJson, readme),
    ...checkUserscriptConfigDocs(inferenceConfigSource, readme),
    ...modelWorkerHttpFacts.errors,
    ...checkModelManifestDocs(modelSource, readme),
    ...checkOnnxRuntimeAssetsDocs(onnxRuntimeAssetsSource, userscriptPackageJson, readme),
    ...checkModelWorkerDocs(readme, modelWorkerHttpFacts),
    ...checkArchitectureGuardrails(readme),
    ...checkExtensionDocs(extensionPackageJson, browserSupportModule.browserSupport, readme, extensionDoc),
  ]
}

async function readJson(repoRoot, relativePath) {
  return JSON.parse(await readText(repoRoot, relativePath))
}

async function readText(repoRoot, relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8')
}

async function importBrowserSupport(repoRoot) {
  const url = pathToFileURL(resolve(repoRoot, 'apps/extension/scripts/browser-support.mjs'))
  url.searchParams.set('repoRoot', repoRoot)
  return import(url.href)
}

export { checkDocsDrift, parseModelManifest, parseOnnxRuntimeAssetsManifest }
