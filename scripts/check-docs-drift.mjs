import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOnnxRuntimeAssetsManifest } from '../apps/userscript/scripts/onnx-runtime-assets.mjs'
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
  const [
    rootPackageJson,
    userscriptPackageJson,
    readme,
    inferenceConfigSource,
    onnxRuntimeAssetsSource,
    modelWorkerRequestRouterSource,
    modelWorkerAccessSource,
    modelWorkerResponseSource,
    modelSource,
  ] = await Promise.all([
    readJson(repoRoot, 'package.json'),
    readJson(repoRoot, 'apps/userscript/package.json'),
    readText(repoRoot, 'README.md'),
    readText(repoRoot, 'apps/userscript/src/inference/inference-config.ts'),
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
    expectedAssets.scriptAsset.path,
    expectedAssets.scriptAsset.filename,
    'scriptAsset.byteLength',
    'scriptAsset.sha256',
    'scriptAsset.maxByteLength',
    'cdn.scriptUrl',
    'cdn.wasmPath',
    'verify-onnx-runtime-assets',
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

function readModelWorkerHttpFacts(requestRouterSource, modelAccessSource, modelResponseSource) {
  const errors = []
  const allowedMethods = readStringConstant(
    requestRouterSource,
    'ALLOWED_METHODS',
    'apps/model-worker/src/request-router.ts',
    errors,
  )
  const corsAllowMethods = readStringConstant(
    modelResponseSource,
    'CORS_ALLOW_METHODS',
    'apps/model-worker/src/model-response.ts',
    errors,
  )
  const corsAllowHeaders = readStringConstant(
    modelResponseSource,
    'CORS_ALLOW_HEADERS',
    'apps/model-worker/src/model-response.ts',
    errors,
  )
  const cacheControl = readStringConstant(
    modelResponseSource,
    'CACHE_CONTROL',
    'apps/model-worker/src/model-response.ts',
    errors,
  )
  const selectedObjectMissingMessage = readStringConstant(
    modelResponseSource,
    'INTERNAL_ERROR_MESSAGE',
    'apps/model-worker/src/model-response.ts',
    errors,
  )
  const selectedObjectMissingStatus = readSelectedObjectMissingStatus(modelResponseSource, errors)
  validateModelWorkerHttpUseSites(requestRouterSource, modelResponseSource, errors)

  if (!hasBearerAuthorizationAccessPath(modelAccessSource) || !hasBearerAuthorizationSelectionPath(modelAccessSource)) {
    errors.push('apps/model-worker/src/model-access.ts must read Authorization: Bearer tokens')
  }
  const queryStringKeyArguments = extractStringCallArgumentsFromCode(modelAccessSource, 'searchParams.get')
  if (queryStringKeyArguments.some((value) => value.toLowerCase() === 'key')) {
    errors.push('apps/model-worker/src/model-access.ts must not read query-string key unless README contract is updated')
  }

  return {
    allowedMethods,
    cacheControl,
    corsAllowHeaders,
    corsAllowMethods,
    errors,
    selectedObjectMissingMessage,
    selectedObjectMissingStatus,
  }
}

function readStringConstant(source, constantName, sourcePath, errors) {
  const value = readConstStringLiteral(source, constantName)
  if (!value) {
    errors.push(`${sourcePath} must define ${constantName} as a string literal`)
    return null
  }
  return value
}

function validateModelWorkerHttpUseSites(requestRouterSource, modelResponseSource, errors) {
  const handleRequestBody = readFunctionBodySource(requestRouterSource, 'handleRequest')
  if (!hasIdentifierPropertyWithIdentifierValue(handleRequestBody, 'allow', 'ALLOWED_METHODS')) {
    errors.push('apps/model-worker/src/request-router.ts must use ALLOWED_METHODS for HTTP 405 Allow responses')
  }

  const preflightResponseBody = readFunctionBodySource(modelResponseSource, 'preflightResponse')
  if (!hasStringPropertyWithIdentifierValue(preflightResponseBody, 'access-control-allow-headers', 'CORS_ALLOW_HEADERS')) {
    errors.push('apps/model-worker/src/model-response.ts must use CORS_ALLOW_HEADERS for Access-Control-Allow-Headers')
  }
  if (!hasStringPropertyWithIdentifierValue(preflightResponseBody, 'access-control-allow-methods', 'CORS_ALLOW_METHODS')) {
    errors.push('apps/model-worker/src/model-response.ts must use CORS_ALLOW_METHODS for Access-Control-Allow-Methods')
  }
  if (!hasStringPropertyWithIdentifierValue(preflightResponseBody, 'cache-control', 'CACHE_CONTROL')) {
    errors.push('apps/model-worker/src/model-response.ts must use CACHE_CONTROL for OPTIONS Cache-Control')
  }

  const textResponseBody = readFunctionBodySource(modelResponseSource, 'textResponse')
  if (!hasMemberCallWithStringAndIdentifierArgument(textResponseBody, 'responseHeaders', 'set', 'cache-control', 'CACHE_CONTROL')) {
    errors.push('apps/model-worker/src/model-response.ts must use CACHE_CONTROL for text responses')
  }

  const createModelHeadersBody = readFunctionBodySource(modelResponseSource, 'createModelHeaders')
  if (!hasStringPropertyWithIdentifierValue(createModelHeadersBody, 'cache-control', 'CACHE_CONTROL')) {
    errors.push('apps/model-worker/src/model-response.ts must use CACHE_CONTROL for model responses')
  }
}

function hasStringPropertyWithIdentifierValue(source, propertyName, identifierName) {
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredCommentOrTemplateOrRegex(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    const parsed = parseStringLiteral(source, index)
    if (!parsed) {
      continue
    }
    if (parsed.value.toLowerCase() === propertyName.toLowerCase()) {
      const colonIndex = skipWhitespaceAndComments(source, parsed.end)
      const valueIndex = skipWhitespaceAndComments(source, colonIndex + 1)
      if (source[colonIndex] === ':' && identifierAt(source, valueIndex, identifierName)) {
        return true
      }
    }
    index = parsed.end - 1
  }
  return false
}

function skipIgnoredCommentOrTemplateOrRegex(source, index) {
  const commentEnd = skipIgnoredComment(source, index)
  if (commentEnd !== index) {
    return commentEnd
  }
  if (source[index] === '`') {
    return skipTemplateLiteral(source, index)
  }
  if (source[index] === '/') {
    return readRegexLiteralEnd(source, index)
  }
  return index
}

function hasIdentifierPropertyWithIdentifierValue(source, propertyName, identifierName) {
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (!identifierAt(source, index, propertyName)) {
      continue
    }
    const colonIndex = skipWhitespaceAndComments(source, index + propertyName.length)
    const valueIndex = skipWhitespaceAndComments(source, colonIndex + 1)
    if (source[colonIndex] === ':' && identifierAt(source, valueIndex, identifierName)) {
      return true
    }
  }
  return false
}

function hasMemberCallWithStringAndIdentifierArgument(source, objectName, methodName, stringArgument, identifierArgument) {
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (!identifierAt(source, index, objectName)) {
      continue
    }
    const dotIndex = skipWhitespaceAndComments(source, index + objectName.length)
    const methodStart = skipWhitespaceAndComments(source, dotIndex + 1)
    const openParenIndex = skipWhitespaceAndComments(source, methodStart + methodName.length)
    if (source[dotIndex] !== '.' || !identifierAt(source, methodStart, methodName) || source[openParenIndex] !== '(') {
      continue
    }
    const firstArgument = parseStringLiteral(source, skipWhitespaceAndComments(source, openParenIndex + 1))
    if (!firstArgument || firstArgument.value.toLowerCase() !== stringArgument.toLowerCase()) {
      continue
    }
    const commaIndex = skipWhitespaceAndComments(source, firstArgument.end)
    const secondArgumentStart = skipWhitespaceAndComments(source, commaIndex + 1)
    if (source[commaIndex] === ',' && identifierAt(source, secondArgumentStart, identifierArgument)) {
      return true
    }
  }
  return false
}

function readSelectedObjectMissingStatus(modelResponseSource, errors) {
  const createModelResponseBody = readFunctionBodySource(modelResponseSource, 'createModelResponse')
  const bucketGetIndex = createModelResponseBody.indexOf('env.modelBucket.get')
  const searchSource = bucketGetIndex === -1 ? '' : createModelResponseBody.slice(bucketGetIndex)
  const match = /if\s*\(\s*(?:object\s*={2,3}\s*null|null\s*={2,3}\s*object|object\s*==\s*null)\s*\)\s*(?:{\s*)?return\s+textResponse\(\s*request\s*,\s*INTERNAL_ERROR_MESSAGE\s*,\s*(?<status>[0-9]+)/s.exec(stripIgnoredSyntax(stripDeadFalseBranches(searchSource)))
  const status = match?.groups?.status
  if (!status) {
    errors.push('apps/model-worker/src/model-response.ts must return a literal status for selected R2 object misses')
    return null
  }
  return status
}

function readConstStringLiteral(source, constantName) {
  const valueStart = readTopLevelConstValueStart(source, constantName)
  if (valueStart === -1) {
    return null
  }
  const parsed = parseStringLiteral(source, valueStart)
  if (!parsed || !hasConstLiteralTerminator(source, parsed.end)) {
    return null
  }
  return parsed.value
}

function hasConstLiteralTerminator(source, literalEnd) {
  const suffixStart = readConstLiteralBoundary(source, literalEnd)
  if (suffixStart.char === undefined || suffixStart.char === ';' || suffixStart.char === ',') {
    return true
  }
  if (suffixStart.hasLineBreak && isStatementStart(source, suffixStart.index)) {
    return true
  }

  const suffixEnd = skipTypeScriptConstSuffix(source, suffixStart.index)
  if (suffixEnd === suffixStart.index) {
    return false
  }
  const boundary = readConstLiteralBoundary(source, suffixEnd)
  if (boundary.char === undefined || boundary.char === ';' || boundary.char === ',') {
    return true
  }
  return boundary.hasLineBreak && isStatementStart(source, boundary.index)
}

function readConstLiteralBoundary(source, startIndex) {
  let index = startIndex
  let hasLineBreak = false
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      hasLineBreak ||= source[index] === '\n' || source[index] === '\r'
      index += 1
      continue
    }
    const skipped = skipIgnoredComment(source, index)
    if (skipped === index) {
      break
    }
    hasLineBreak ||= source.slice(index, skipped).includes('\n') || skipped === source.length
    index = skipped
  }
  return { char: source[index], hasLineBreak, index }
}

function isStatementStart(source, index) {
  return identifierAt(source, index, 'export')
    || identifierAt(source, index, 'import')
    || identifierAt(source, index, 'const')
    || identifierAt(source, index, 'let')
    || identifierAt(source, index, 'var')
    || identifierAt(source, index, 'function')
    || identifierAt(source, index, 'type')
    || identifierAt(source, index, 'interface')
    || source[index] === '}'
}

function skipTypeScriptConstSuffix(source, startIndex) {
  let index = startIndex
  const firstSuffixEnd = skipSingleTypeScriptConstSuffix(source, index)
  if (firstSuffixEnd === index) {
    return startIndex
  }
  index = skipWhitespaceAndComments(source, firstSuffixEnd)
  const secondSuffixEnd = skipSingleTypeScriptConstSuffix(source, index)
  return secondSuffixEnd === index ? firstSuffixEnd : secondSuffixEnd
}

function skipSingleTypeScriptConstSuffix(source, startIndex) {
  let index = startIndex
  if (identifierAt(source, index, 'as')) {
    index = skipWhitespaceAndComments(source, index + 'as'.length)
    if (!identifierAt(source, index, 'const')) {
      return startIndex
    }
    return index + 'const'.length
  }
  if (identifierAt(source, index, 'satisfies')) {
    index = skipWhitespaceAndComments(source, index + 'satisfies'.length)
    while (index < source.length && source[index] !== ';' && source[index] !== ',' && source[index] !== '\n' && source[index] !== '\r') {
      const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
      if (skipped !== index) {
        index = skipped
        continue
      }
      index += 1
    }
    return index
  }
  return startIndex
}

function readTopLevelConstValueStart(source, constantName) {
  let depth = 0
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (source[index] === '{') {
      depth += 1
      continue
    }
    if (source[index] === '}') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0 || !identifierAt(source, index, 'const')) {
      continue
    }
    const nameStart = skipWhitespaceAndComments(source, index + 'const'.length)
    if (!identifierAt(source, nameStart, constantName)) {
      continue
    }
    const equalsIndex = readConstEqualsIndex(source, nameStart + constantName.length)
    if (equalsIndex !== -1) {
      return skipWhitespaceAndComments(source, equalsIndex + 1)
    }
  }
  return -1
}

function readConstEqualsIndex(source, startIndex) {
  let index = skipWhitespaceAndComments(source, startIndex)
  if (source[index] === ':') {
    index += 1
    while (index < source.length) {
      const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
      if (skipped !== index) {
        index = skipped
        continue
      }
      if (source[index] === '=') {
        return index
      }
      if (source[index] === '\n' || source[index] === '\r' || source[index] === ';') {
        return -1
      }
      index += 1
    }
    return -1
  }
  return source[index] === '=' ? index : -1
}

function extractStringCallArgumentsFromCode(source, callee) {
  const values = []
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (!source.startsWith(callee, index)
      || isIdentifierPart(source[index - 1])
      || isIdentifierPart(source[index + callee.length])) {
      continue
    }

    const openParenIndex = skipWhitespaceAndComments(source, index + callee.length)
    if (source[openParenIndex] !== '(') {
      continue
    }
    const argumentStart = skipWhitespaceAndComments(source, openParenIndex + 1)
    const parsed = parseStringLiteral(source, argumentStart)
    if (!parsed) {
      continue
    }
    const argumentEnd = skipWhitespaceAndComments(source, parsed.end)
    if (source[argumentEnd] === ')') {
      values.push(parsed.value)
    }
    index = parsed.end - 1
  }
  return values
}

function hasBearerAuthorizationAccessPath(source) {
  const body = stripDeadFalseBranches(readFunctionBodySource(source, 'getRequestAccessToken'))
  const literal = readConstRegexLiteral(source, 'BEARER_AUTHORIZATION_PATTERN')
  if (!hasBearerTokenCapture(literal)) {
    return false
  }
  const authorization = readAuthorizationHeaderVariable(body)
  if (!authorization) {
    return false
  }
  const execPattern = new RegExp(String.raw`const\s+(?<match>[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*BEARER_AUTHORIZATION_PATTERN\.exec\(\s*${authorization}\.trim\(\s*\)\s*\)`)
  const execMatch = execPattern.exec(stripIgnoredSyntax(body))
  const matchVariable = execMatch?.groups?.match
  if (!matchVariable) {
    return false
  }
  return new RegExp(String.raw`return\s+${matchVariable}\?\.\[\s*1\s*\]\s*\?\?\s*null`).test(stripIgnoredSyntax(body))
}

function readAuthorizationHeaderVariable(source) {
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (!identifierAt(source, index, 'const')) {
      continue
    }
    const nameStart = skipWhitespaceAndComments(source, index + 'const'.length)
    const variableName = readIdentifierToken(source, nameStart)
    if (!variableName) {
      continue
    }
    const equalsIndex = skipWhitespaceAndComments(source, nameStart + variableName.length)
    const calleeStart = skipWhitespaceAndComments(source, equalsIndex + 1)
    if (source[equalsIndex] !== '=' || !source.startsWith('request.headers.get', calleeStart)) {
      continue
    }
    const openParenIndex = skipWhitespaceAndComments(source, calleeStart + 'request.headers.get'.length)
    if (source[openParenIndex] !== '(') {
      continue
    }
    const parsed = parseStringLiteral(source, skipWhitespaceAndComments(source, openParenIndex + 1))
    if (!parsed || parsed.value.toLowerCase() !== 'authorization') {
      continue
    }
    const closeParenIndex = skipWhitespaceAndComments(source, parsed.end)
    if (source[closeParenIndex] === ')') {
      return variableName
    }
  }
  return null
}

function readIdentifierToken(source, startIndex) {
  if (!/[A-Za-z_$]/.test(source[startIndex] ?? '')) {
    return null
  }
  let endIndex = startIndex + 1
  while (isIdentifierPart(source[endIndex])) {
    endIndex += 1
  }
  return source.slice(startIndex, endIndex)
}

function hasBearerAuthorizationSelectionPath(source) {
  const body = stripDeadFalseBranches(readFunctionBodySource(source, 'selectModelAccess'))
  return /getModelAccessTokenLookupKeys\(\s*getRequestAccessToken\(\s*request\s*\)\s*\)/.test(stripIgnoredSyntax(body))
}

function hasBearerTokenCapture(literal) {
  if (literal === null || !/^\/\^Bearer\\s\+\(/.test(literal)) {
    return false
  }
  return !/^\/\^Bearer\\s\+\(\?(?::|=|!|<=|<!)/.test(literal)
}

function readFunctionBodySource(source, functionName) {
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (!identifierAt(source, index, 'function')) {
      continue
    }
    const nameStart = skipWhitespaceAndComments(source, index + 'function'.length)
    if (!identifierAt(source, nameStart, functionName)) {
      continue
    }
    const paramsStart = skipWhitespaceAndComments(source, nameStart + functionName.length)
    if (source[paramsStart] !== '(') {
      continue
    }
    const paramsEnd = findMatchingParen(source, paramsStart)
    if (paramsEnd === -1) {
      return ''
    }
    const bodyStart = skipFunctionReturnType(source, paramsEnd + 1)
    if (source[bodyStart] !== '{') {
      return ''
    }
    const bodyEnd = findMatchingBrace(source, bodyStart)
    return bodyEnd === -1 ? '' : source.slice(bodyStart + 1, bodyEnd)
  }
  return ''
}

function skipFunctionReturnType(source, startIndex) {
  let index = skipWhitespaceAndComments(source, startIndex)
  if (source[index] !== ':') {
    return index
  }
  index += 1
  while (index < source.length) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped
      continue
    }
    if (source[index] === '{') {
      return index
    }
    index += 1
  }
  return index
}

function readConstRegexLiteral(source, constantName) {
  const valueStart = readTopLevelConstValueStart(source, constantName)
  if (valueStart === -1 || source[valueStart] !== '/') {
    return null
  }
  const literalEnd = readRegexLiteralEnd(source, valueStart)
  return literalEnd === valueStart ? null : source.slice(valueStart, literalEnd)
}

function stripIgnoredSyntax(source) {
  let result = ''
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      result += source.slice(index, skipped).replace(/[^\r\n]/g, ' ')
      index = skipped - 1
      continue
    }
    result += source[index]
  }
  return result
}

function stripDeadFalseBranches(source) {
  let result = ''
  for (let index = 0; index < source.length; index += 1) {
    const stripped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (stripped !== index) {
      result += source.slice(index, stripped)
      index = stripped - 1
      continue
    }
    if (source.startsWith('if', index) && !isIdentifierPart(source[index - 1]) && !isIdentifierPart(source[index + 2])) {
      const conditionStart = skipWhitespaceAndComments(source, index + 2)
      if (source[conditionStart] === '(') {
        const conditionEnd = findMatchingParen(source, conditionStart)
        if (conditionEnd !== -1 && stripIgnoredSyntax(source.slice(conditionStart + 1, conditionEnd)).trim() === 'false') {
          const bodyStart = skipWhitespaceAndComments(source, conditionEnd + 1)
          if (source[bodyStart] === '{') {
            const bodyEnd = findMatchingBrace(source, bodyStart)
            if (bodyEnd !== -1) {
              result += source.slice(index, bodyEnd + 1).replace(/[^\r\n]/g, ' ')
              index = bodyEnd
              continue
            }
          }
        }
      }
    }
    result += source[index]
  }
  return result
}

function findMatchingParen(source, openParenIndex) {
  return findMatchingDelimitedToken(source, openParenIndex, '(', ')')
}

function findMatchingBrace(source, openBraceIndex) {
  return findMatchingDelimitedToken(source, openBraceIndex, '{', '}')
}

function findMatchingDelimitedToken(source, openIndex, openToken, closeToken) {
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (source[index] === openToken) {
      depth += 1
      continue
    }
    if (source[index] === closeToken) {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }
  return -1
}

function readRegexLiteralEnd(source, startIndex) {
  let isEscaped = false
  let isInCharacterClass = false
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index]
    if (isEscaped) {
      isEscaped = false
    } else if (char === '\\') {
      isEscaped = true
    } else if (char === '[') {
      isInCharacterClass = true
    } else if (char === ']') {
      isInCharacterClass = false
    } else if (char === '/' && !isInCharacterClass) {
      let endIndex = index + 1
      while (/[A-Za-z]/.test(source[endIndex] ?? '')) {
        endIndex += 1
      }
      return endIndex
    } else if (char === '\n' || char === '\r') {
      return startIndex
    }
  }
  return startIndex
}

function skipIgnoredSyntaxAndRegexLiteral(source, index) {
  const skipped = skipIgnoredSyntax(source, index)
  if (skipped !== index) {
    return skipped
  }
  return source[index] === '/' ? readRegexLiteralEnd(source, index) : index
}

function skipIgnoredSyntax(source, index) {
  const char = source[index]
  const nextChar = source[index + 1]
  if (char === '/' && nextChar === '/') {
    return skipLineComment(source, index)
  }
  if (char === '/' && nextChar === '*') {
    return skipBlockComment(source, index)
  }
  if (char === '\'' || char === '"') {
    return skipStringLiteral(source, index)
  }
  if (char === '`') {
    return skipTemplateLiteral(source, index)
  }
  return index
}

function skipWhitespaceAndComments(source, startIndex) {
  let index = startIndex
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1
      continue
    }
    const skipped = skipIgnoredComment(source, index)
    if (skipped === index) {
      return index
    }
    index = skipped
  }
  return index
}

function skipIgnoredComment(source, index) {
  const char = source[index]
  const nextChar = source[index + 1]
  if (char === '/' && nextChar === '/') {
    return skipLineComment(source, index)
  }
  if (char === '/' && nextChar === '*') {
    return skipBlockComment(source, index)
  }
  return index
}

function skipLineComment(source, startIndex) {
  const endIndex = source.indexOf('\n', startIndex + 2)
  return endIndex === -1 ? source.length : endIndex + 1
}

function skipBlockComment(source, startIndex) {
  const endIndex = source.indexOf('*/', startIndex + 2)
  return endIndex === -1 ? source.length : endIndex + 2
}

function skipStringLiteral(source, startIndex) {
  const quote = source[startIndex]
  let isEscaped = false
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index]
    if (isEscaped) {
      isEscaped = false
    } else if (char === '\\') {
      isEscaped = true
    } else if (char === quote) {
      return index + 1
    } else if (char === '\n' || char === '\r') {
      return source.length
    }
  }
  return source.length
}

function skipTemplateLiteral(source, startIndex) {
  let isEscaped = false
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index]
    if (isEscaped) {
      isEscaped = false
    } else if (char === '\\') {
      isEscaped = true
    } else if (char === '`') {
      return index + 1
    } else if (char === '$' && source[index + 1] === '{') {
      index = skipTemplateExpression(source, index + 2) - 1
    }
  }
  return source.length
}

function skipTemplateExpression(source, startIndex) {
  let depth = 1
  for (let index = startIndex; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntax(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) {
        return index + 1
      }
    }
  }
  return source.length
}

function parseStringLiteral(source, valueStart) {
  const quote = source[valueStart]
  if (quote !== '\'' && quote !== '"') {
    return null
  }

  let value = ''
  let isEscaped = false
  for (let index = valueStart + 1; index < source.length; index += 1) {
    const char = source[index]
    if (isEscaped) {
      value += char
      isEscaped = false
    } else if (char === '\\') {
      value += char
      isEscaped = true
    } else if (char === quote) {
      return { value, end: index + 1 }
    } else if (char === '\n' || char === '\r') {
      return null
    } else {
      value += char
    }
  }
  return null
}

function identifierAt(source, index, identifier) {
  return source.startsWith(identifier, index)
    && !isIdentifierPart(source[index - 1])
    && !isIdentifierPart(source[index + identifier.length])
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_$]/.test(char ?? '')
}

function checkModelWorkerDocs(readme, facts) {
  const errors = []
  const lines = readme.split(/\r?\n/)
  const authorizedGetLine = findModelWorkerHttpRow(lines, 'GET')
  if (!authorizedGetLine.includes('Authorization: Bearer')) {
    errors.push('README.md Model Worker authorized real-model row must mention Authorization: Bearer')
  }
  if (facts.cacheControl && !lineMentionsHeaderValue(authorizedGetLine, 'Cache-Control', facts.cacheControl)) {
    errors.push(`README.md Model Worker authorized real-model row must mention Cache-Control: ${facts.cacheControl}`)
  }

  const authorizedHeadLine = findModelWorkerHttpRow(lines, 'HEAD')
  if (!authorizedHeadLine.includes('Authorization: Bearer')) {
    errors.push('README.md Model Worker authorized HEAD row must mention Authorization: Bearer')
  }

  const optionsLine = findModelWorkerHttpRow(lines, 'OPTIONS')
  if (facts.corsAllowMethods && !lineMentionsHeaderValue(optionsLine, 'Access-Control-Allow-Methods', facts.corsAllowMethods)) {
    errors.push(`README.md Model Worker OPTIONS docs must mention Access-Control-Allow-Methods: ${facts.corsAllowMethods}`)
  }
  if (facts.corsAllowHeaders && !lineMentionsHeaderValue(optionsLine, 'Access-Control-Allow-Headers', facts.corsAllowHeaders)) {
    errors.push(`README.md Model Worker OPTIONS docs must mention Access-Control-Allow-Headers: ${facts.corsAllowHeaders}`)
  }

  const methodNotAllowedLine = findMethodNotAllowedDocsLine(lines)
  if (facts.allowedMethods && !lineMentionsHeaderValue(methodNotAllowedLine, 'Allow', facts.allowedMethods)) {
    errors.push(`README.md Model Worker HTTP 405 docs must mention Allow: ${facts.allowedMethods} on the method-not-allowed row`)
  }
  if (lines.some(hasStaleMethodAllowHeader)) {
    errors.push('README.md Model Worker HTTP 405 docs must not document stale Allow: GET, HEAD semantics')
  }

  const queryStringLines = lines.filter(isQueryStringKeyDocsLine)
  if (!queryStringLines.some(statesQueryStringDoesNotAuthorizeRealModel)) {
    errors.push('README.md Model Worker HTTP docs must state query-string key does not authorize the real model')
  }
  if (queryStringLines.some(impliesQueryStringAuthorizesRealModel)) {
    errors.push('README.md Model Worker HTTP docs must not imply query-string key authorization or real model access')
  }

  const selectedObjectMissingLine = lines.find(isSelectedObjectMissingDocsLine) ?? ''
  if (facts.selectedObjectMissingStatus && facts.selectedObjectMissingMessage
    && !selectedObjectMissingLine.includes(`${facts.selectedObjectMissingStatus} ${facts.selectedObjectMissingMessage}`)) {
    errors.push(`README.md Model Worker selected R2 object missing docs must mention ${facts.selectedObjectMissingStatus} ${facts.selectedObjectMissingMessage}`)
  }

  if (lines.some((line) => line.includes('Cache-Control: public, max-age=86400'))) {
    errors.push('README.md Model Worker HTTP docs must not document stale Cache-Control: public, max-age=86400 semantics')
  }

  return errors
}

function findModelWorkerHttpRow(lines, method) {
  const escapedMethod = escapeRegExp(method)
  const rowPattern = new RegExp(`^\\|\\s*\`${escapedMethod}\\s+/`)
  return lines.find((line) => rowPattern.test(line)) ?? ''
}

function findMethodNotAllowedDocsLine(lines) {
  return lines.find(isMethodNotAllowedDocsLine) ?? ''
}

function lineMentionsHeaderValue(line, headerName, value) {
  const escapedHeaderValue = escapeRegExp(`${headerName}: ${value}`)
  return new RegExp(`(?:\`${escapedHeaderValue}\`|${escapedHeaderValue}(?=$|[\\s，。;；|)]))`).test(line)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isMethodNotAllowedDocsLine(line) {
  return /^\|\s*非\s+`GET`\s*\/\s*`HEAD`\s*\/\s*`OPTIONS`\s+方法\s*\|/.test(line)
}

function hasStaleMethodAllowHeader(line) {
  return /Allow: GET, HEAD(?!, OPTIONS)/.test(line)
}

function isQueryStringKeyDocsLine(line) {
  return /(?:query[-\s]+string\s+key|key\s+query\s+string|query\s+param(?:eter)?\s+key|search\s+param(?:eter)?\s+key|url\s+param(?:eter)?\s+key|[?&]key=)/i.test(line)
}

function statesQueryStringDoesNotAuthorizeRealModel(line) {
  const denial = String.raw`(?:does\s+not|doesn't|do\s+not|must\s+not|should\s+not|never|cannot|can't|can\s+not)`
  const realModel = String.raw`(?:a\s+|the\s+)?real model`
  return new RegExp(
    String.raw`(?:不(?:会|能)?授权真实模型|不(?:会|能)?返回真实模型|${denial}\s+(?:authori[sz]es?|returns?|serves?)\s+(?:access\s+to\s+)?${realModel}|${denial}\s+grants?\s+(?:access\s+to\s+)?${realModel})`,
    'i',
  ).test(line)
}

function impliesQueryStringAuthorizesRealModel(line) {
  const querySegments = line.split(/[.;。；]/).filter(isQueryStringKeyDocsLine)
  return querySegments.some((segment) => queryStringSegmentAuthorizesRealModel(stripAllowedQueryStringDenials(segment)))
}

function stripAllowedQueryStringDenials(line) {
  const denial = String.raw`(?:does\s+not|doesn't|do\s+not|must\s+not|should\s+not|never|cannot|can't|can\s+not)`
  const realModel = String.raw`(?:a\s+|the\s+)?real model`
  return line
    .replace(/不(?:会|能)?授权真实模型/g, '')
    .replace(/不(?:会|能)?返回真实模型/g, '')
    .replace(new RegExp(String.raw`\b${denial}\s+(?:authori[sz]es?|returns?|serves?)\s+(?:access\s+to\s+)?${realModel}\b`, 'gi'), '')
    .replace(new RegExp(String.raw`\b${denial}\s+grants?\s+(?:access\s+to\s+)?${realModel}\b`, 'gi'), '')
    .replace(/\b(?:while|but)\s+(?:Authorization:\s*)?Bearer(?:\s+token)?\b[^.;。；]*/gi, '')
    .replace(/,\s*(?:Authorization:\s*)?Bearer(?:\s+token)?\b[^.;。；]*/gi, '')
}

function queryStringSegmentAuthorizesRealModel(line) {
  return /(?:授权真实模型|(?:会|可)?返回\s*(?:`?200`?\s*)?真实模型|returns?\s+(?:(?:`?200`?|\d{3})[\s,，]*)?(?:a\s+|the\s+)?real model|serves?\s+(?:a\s+|the\s+)?real model|authori[sz]es?\s+(?:access\s+to\s+)?(?:a\s+|the\s+)?real model|grants?\s+(?:access\s+to\s+)?(?:a\s+|the\s+)?real model|can\s+grant\s+access\s+to\s+(?:a\s+|the\s+)?real model|200\s*(?:真实模型|real model))/i.test(line)
}

function isSelectedObjectMissingDocsLine(line) {
  return /^\|\s*选中的 R2 object 缺失\s*\|/.test(line)
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

export { checkDocsDrift, parseModelManifest, parseOnnxRuntimeAssetsManifest, resolveRepoRoot }
