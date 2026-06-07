import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  const [rootPackageJson, readme, userscriptDocs, deploymentDocs, inferenceConfigSource, modelSource] = await Promise.all([
    readJson(repoRoot, 'package.json'),
    readText(repoRoot, 'README.md'),
    readText(repoRoot, 'docs/userscript.md'),
    readText(repoRoot, 'docs/deployment.md'),
    readText(repoRoot, 'apps/userscript/src/inference/inference-config.ts'),
    readText(repoRoot, 'packages/shared/src/model.ts'),
  ])

  return [
    ...checkRootCheckCommand(rootPackageJson, readme, deploymentDocs, userscriptDocs),
    ...checkUserscriptConfigDocs(inferenceConfigSource, readme),
    ...checkModelManifestDocs(modelSource, readme, userscriptDocs, deploymentDocs),
  ]
}

async function readJson(repoRoot, relativePath) {
  return JSON.parse(await readText(repoRoot, relativePath))
}

async function readText(repoRoot, relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8')
}

function checkRootCheckCommand(rootPackageJson, readme, deploymentDocs, userscriptDocs) {
  const checkCommand = rootPackageJson.scripts?.check
  if (typeof checkCommand !== 'string') {
    return ['package.json scripts.check is missing']
  }

  const filesToCheck = [
    { path: 'README.md', text: readme, commandLabel: 'pnpm check' },
    { path: 'docs/deployment.md', text: deploymentDocs, commandLabel: 'corepack pnpm check' },
    { path: 'docs/userscript.md', text: userscriptDocs, commandLabel: 'corepack pnpm check' },
  ]
  const errors = []
  for (const commandName of ['test:coverage', 'docs:check']) {
    if (!checkCommand.includes(commandName)) {
      continue
    }
    for (const file of filesToCheck) {
      if (!sectionMentions(file.text, file.commandLabel, commandName)) {
        errors.push(`${file.path} ${file.commandLabel} description must mention ${commandName} because package.json scripts.check runs it`)
      }
    }
  }
  return errors
}

function checkUserscriptConfigDocs(inferenceConfigSource, readme) {
  const requiredConfigNames = [
    'yoloOutputConfig',
    'workerInitTimeoutMs',
    'workerDetectTimeoutMs',
    'modelDownloadTimeoutMs',
  ]
  const errors = []
  for (const configName of requiredConfigNames) {
    if (!inferenceConfigSource.includes(`${configName}:`)) {
      errors.push(`apps/userscript/src/inference/inference-config.ts is missing expected core config ${configName}`)
      continue
    }
    if (!readme.includes(configName)) {
      errors.push(`README.md userscript inference config section must mention ${configName}`)
    }
  }
  return errors
}

function checkModelManifestDocs(modelSource, readme, userscriptDocs, deploymentDocs) {
  const docsCorpus = `${readme}\n${userscriptDocs}\n${deploymentDocs}`
  const expectedModel = parseModelManifest(modelSource)
  const errors = []

  if (!docsCorpus.includes(expectedModel.version)) {
    errors.push(`README.md/docs must mention MODEL_VERSION value ${expectedModel.version}`)
  }

  const manifestTerms = ['MODEL_VERSION', 'MODEL_INTEGRITY.byteLength', 'MODEL_INTEGRITY.sha256']
  for (const term of manifestTerms) {
    if (!docsCorpus.includes(term)) {
      errors.push(`README.md/docs must mention ${term} from packages/shared/src/model.ts`)
    }
  }

  const modelDocs = [
    { path: 'docs/userscript.md', text: userscriptDocs },
    { path: 'docs/deployment.md', text: deploymentDocs },
  ]
  for (const doc of modelDocs) {
    for (const term of ['verify-model-integrity', 'MODEL_FILE']) {
      if (!doc.text.includes(term)) {
        errors.push(`${doc.path} model manifest check must mention ${term}`)
      }
    }
  }

  return errors
}

function sectionMentions(text, anchor, required) {
  const anchorIndex = text.indexOf(anchor)
  if (anchorIndex === -1) {
    return false
  }
  const nextHeadingIndex = text.indexOf('\n##', anchorIndex)
  const section = nextHeadingIndex === -1 ? text.slice(anchorIndex) : text.slice(anchorIndex, nextHeadingIndex)
  return section.includes(required)
}

function parseModelManifest(modelSource) {
  const versionMatch = modelSource.match(/MODEL_VERSION\s*=\s*['"]([^'"]+)['"]/)
  const byteLengthMatch = modelSource.match(/MODEL_INTEGRITY\s*=\s*{[\s\S]*?['"]?byteLength['"]?\s*:\s*([0-9][0-9_]*)/)
  const sha256Match = modelSource.match(/MODEL_INTEGRITY\s*=\s*{[\s\S]*?['"]?sha256['"]?\s*:\s*['"]([a-fA-F0-9]{64})['"]/)

  if (!versionMatch?.[1]) {
    throw new Error('Unable to read MODEL_VERSION from packages/shared/src/model.ts')
  }
  if (!byteLengthMatch?.[1]) {
    throw new Error('Unable to read MODEL_INTEGRITY.byteLength from packages/shared/src/model.ts')
  }
  if (!sha256Match?.[1]) {
    throw new Error('Unable to read MODEL_INTEGRITY.sha256 from packages/shared/src/model.ts')
  }

  return {
    version: versionMatch[1],
    byteLength: Number(byteLengthMatch[1].replaceAll('_', '')),
    sha256: sha256Match[1].toLowerCase(),
  }
}

export { checkDocsDrift, parseModelManifest, resolveRepoRoot }
