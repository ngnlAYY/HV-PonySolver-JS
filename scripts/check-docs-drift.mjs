import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseModelManifest } from './model-manifest.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(scriptDir, '..')

if (isDirectRun()) {
  try {
    const repoRoot = resolveRepoRoot(process.argv.slice(2))
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

function isDirectRun() {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
}

function resolveRepoRoot(args) {
  const repoRootIndex = args.indexOf('--repo-root')
  if (repoRootIndex === -1) {
    return defaultRepoRoot
  }
  const repoRoot = args[repoRootIndex + 1]
  if (!repoRoot) {
    throw new Error('--repo-root requires a path')
  }
  return resolve(repoRoot)
}

async function checkDocsDrift(repoRoot = defaultRepoRoot) {
  const [rootPackageJson, readme, inferenceConfigSource, modelSource] = await Promise.all([
    readJson(repoRoot, 'package.json'),
    readText(repoRoot, 'README.md'),
    readText(repoRoot, 'apps/userscript/src/inference/inference-config.ts'),
    readText(repoRoot, 'packages/shared/src/model.ts'),
  ])

  return [
    ...checkRootCheckCommand(rootPackageJson, readme),
    ...checkUserscriptConfigDocs(inferenceConfigSource, readme),
    ...checkModelManifestDocs(modelSource, readme),
    ...checkArchitectureGuardrails(readme),
  ]
}

async function readJson(repoRoot, relativePath) {
  return JSON.parse(await readText(repoRoot, relativePath))
}

async function readText(repoRoot, relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8')
}

function checkRootCheckCommand(rootPackageJson, readme) {
  const checkCommand = rootPackageJson.scripts?.check
  if (typeof checkCommand !== 'string') {
    return ['package.json scripts.check is missing']
  }

  const errors = []
  for (const commandName of ['check:quick', 'test:coverage', 'build']) {
    if (checkCommand.includes(commandName) && !commandDescriptionMentions(readme, 'pnpm check', commandName)) {
      errors.push(`README.md pnpm check description must mention ${commandName} because package.json scripts.check runs it`)
    }
  }

  const quickCheckCommand = rootPackageJson.scripts?.['check:quick']
  if (checkCommand.includes('check:quick') && typeof quickCheckCommand !== 'string') {
    errors.push('package.json scripts.check:quick is missing because package.json scripts.check runs it')
    return errors
  }
  if (typeof quickCheckCommand !== 'string') {
    return errors
  }
  for (const commandName of ['lint', 'typecheck', 'test', 'docs:check', 'graphify:check', 'architecture:check']) {
    if (quickCheckCommand.includes(commandName) && !commandDescriptionMentions(readme, 'pnpm check:quick', commandName)) {
      errors.push(`README.md pnpm check:quick description must mention ${commandName} because package.json scripts.check:quick runs it`)
    }
  }
  return errors
}

function checkUserscriptConfigDocs(inferenceConfigSource, readme) {
  const requiredConfigs = ['imagePreprocessConfig', 'yoloOutputConfig', 'onnxRuntimeConfig', 'inferenceTimeoutConfig']
  const requiredConfigNames = [
    'imageSize',
    'confidenceThreshold',
    'maxDetections',
    'maxKinds',
    'rowSize',
    'confidenceIndex',
    'classIndex',
    'workerInitTimeoutMs',
    'workerDetectTimeoutMs',
    'modelDownloadTimeoutMs',
  ]
  const errors = []
  for (const configName of requiredConfigs) {
    if (!inferenceConfigSource.includes(`export const ${configName}`)) {
      errors.push(`apps/userscript/src/inference/inference-config.ts is missing expected config export ${configName}`)
      continue
    }
    if (!readme.includes(configName)) {
      errors.push(`README.md must mention ${configName}`)
    }
  }
  for (const configName of requiredConfigNames) {
    if (!inferenceConfigSource.includes(`${configName}:`)) {
      errors.push(`apps/userscript/src/inference/inference-config.ts is missing expected config ${configName}`)
      continue
    }
    if (!readme.includes(configName)) {
      errors.push(`README.md must mention ${configName}`)
    }
  }
  return errors
}

function checkModelManifestDocs(modelSource, readme) {
  const expectedModel = parseModelManifest(modelSource)
  const errors = []

  if (!readme.includes(expectedModel.version)) {
    errors.push(`README.md must mention MODEL_VERSION value ${expectedModel.version}`)
  }

  const manifestTerms = ['MODEL_VERSION', 'MODEL_INTEGRITY.byteLength', 'MODEL_INTEGRITY.sha256']
  for (const term of manifestTerms) {
    if (!readme.includes(term)) {
      errors.push(`README.md must mention ${term} from packages/shared/src/model.ts`)
    }
  }

  for (const term of ['verify-model-integrity', 'MODEL_FILE']) {
    if (!readme.includes(term)) {
      errors.push(`README.md model manifest check must mention ${term}`)
    }
  }

  return errors
}

function checkArchitectureGuardrails(readme) {
  const requiredTerms = [
    '.graphifyignore',
    'graphify:check',
    'architecture:check',
    'inferenceTimeoutConfig',
    'StatusPanel',
    'Model Worker Core',
  ]
  const errors = []
  for (const term of requiredTerms) {
    if (!readme.includes(term)) {
      errors.push(`README.md graph guardrails section must mention ${term}`)
    }
  }
  return errors
}

function commandDescriptionMentions(readme, command, required) {
  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const commandRowPattern = new RegExp(`^\\|\\s*\`${escapedCommand}\`\\s*\\|(?<description>.*)\\|\\s*$`, 'm')
  const description = commandRowPattern.exec(readme)?.groups?.description
  return description?.includes(required) ?? false
}

export { checkDocsDrift, parseModelManifest, resolveRepoRoot }
