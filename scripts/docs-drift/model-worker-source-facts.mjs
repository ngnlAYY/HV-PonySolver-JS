import {
  extractStringCallArgumentsFromCode,
  parseStringLiteral,
  readConstRegexLiteral,
  readConstStringLiteral,
  readFunctionBodySource,
  readIdentifierToken,
} from './source-literals.mjs'
import {
  identifierAt,
  readRegexLiteralEnd,
  skipIgnoredComment,
  skipIgnoredSyntaxAndRegexLiteral,
  skipTemplateLiteral,
  skipWhitespaceAndComments,
  stripDeadFalseBranches,
  stripIgnoredSyntax,
} from './source-syntax.mjs'

// 这里有意只做窄范围源码事实提取，用于 README drift 检查。
// 它不是通用 TypeScript parser；运行时 HTTP 行为应由 apps/model-worker 的 Worker tests 覆盖。
// 本文件只保证文档检查读取的是预期源码事实，并避免被注释、字符串、regex 和死代码误导。
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
  const selectedObjectMissingStatus = readSelectedObjectMissingStatus(modelResponseSource, requestRouterSource, errors)
  validateModelWorkerHttpUseSites(requestRouterSource, modelResponseSource, errors)

  if (!hasBearerAuthorizationAccessPath(modelAccessSource) || !hasBearerAuthorizationSelectionPath(modelAccessSource)) {
    errors.push('apps/model-worker/src/model-access.ts must read Authorization: Bearer tokens')
  }
  const queryStringKeyArguments = extractStringCallArgumentsFromCode(modelAccessSource, 'searchParams.get')
  if (queryStringKeyArguments.some((value) => value.toLowerCase() === 'key')) {
    errors.push(
      'apps/model-worker/src/model-access.ts must not read query-string key unless README contract is updated',
    )
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
  if (
    !hasStringPropertyWithIdentifierValue(preflightResponseBody, 'access-control-allow-headers', 'CORS_ALLOW_HEADERS')
  ) {
    errors.push('apps/model-worker/src/model-response.ts must use CORS_ALLOW_HEADERS for Access-Control-Allow-Headers')
  }
  if (
    !hasStringPropertyWithIdentifierValue(preflightResponseBody, 'access-control-allow-methods', 'CORS_ALLOW_METHODS')
  ) {
    errors.push('apps/model-worker/src/model-response.ts must use CORS_ALLOW_METHODS for Access-Control-Allow-Methods')
  }
  if (!hasStringPropertyWithIdentifierValue(preflightResponseBody, 'cache-control', 'CACHE_CONTROL')) {
    errors.push('apps/model-worker/src/model-response.ts must use CACHE_CONTROL for OPTIONS Cache-Control')
  }

  const textResponseBody = readFunctionBodySource(modelResponseSource, 'textResponse')
  if (
    !hasMemberCallWithStringAndIdentifierArgument(
      textResponseBody,
      'responseHeaders',
      'set',
      'cache-control',
      'CACHE_CONTROL',
    )
  ) {
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

function hasMemberCallWithStringAndIdentifierArgument(
  source,
  objectName,
  methodName,
  stringArgument,
  identifierArgument,
) {
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

function readSelectedObjectMissingStatus(modelResponseSource, requestRouterSource, errors) {
  const internalErrorResponseBody = readFunctionBodySource(modelResponseSource, 'internalErrorResponse')
  const statusMatch = /return\s+textResponse\(\s*request\s*,\s*INTERNAL_ERROR_MESSAGE\s*,\s*(?<status>[0-9]+)/s.exec(
    stripIgnoredSyntax(internalErrorResponseBody),
  )
  const serveModelBody = readFunctionBodySource(requestRouterSource, 'serveModel')
  const normalizedServeModelBody = stripIgnoredSyntax(stripDeadFalseBranches(serveModelBody))
  const objectReadMatch = /(?:env\.MODEL_BUCKET\.get|readObjectForRequest)\s*\(/.exec(normalizedServeModelBody)
  const searchSource = objectReadMatch ? normalizedServeModelBody.slice(objectReadMatch.index) : ''
  const missingObjectMatch =
    /if\s*\(\s*(?:!\s*object|object\s*={2,3}\s*null|null\s*={2,3}\s*object|object\s*==\s*null)\s*\)\s*(?:{\s*)?return\s+internalErrorResponse\(\s*request\s*\)/s.exec(
      searchSource,
    )
  const status = statusMatch?.groups?.status
  if (!status || !missingObjectMatch) {
    errors.push('apps/model-worker/src/model-response.ts must return a literal status for selected R2 object misses')
    return null
  }
  return status
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
  const execPattern = new RegExp(
    String.raw`const\s+(?<match>[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*BEARER_AUTHORIZATION_PATTERN\.exec\(\s*${authorization}\.trim\(\s*\)\s*\)`,
  )
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

function hasBearerAuthorizationSelectionPath(source) {
  const body = stripIgnoredSyntax(stripDeadFalseBranches(readFunctionBodySource(source, 'selectModelAccess')))
  const tokenVariable = readSingleRequestAccessTokenVariable(body)
  if (!tokenVariable) {
    return false
  }
  const lookupKeysPattern = new RegExp(String.raw`getModelAccessTokenLookupKeys\(\s*${tokenVariable}\s*\)`)
  const canonicalTokenPattern = new RegExp(String.raw`normalizeModelAccessToken\(\s*${tokenVariable}\s*\)`)
  return lookupKeysPattern.test(body) && canonicalTokenPattern.test(body)
}

// The Authorization header must be parsed exactly once per request: selectModelAccess reads it
// into a single variable that feeds both the KV lookup keys and the canonical token.
function readSingleRequestAccessTokenVariable(body) {
  const declarationPattern = /const\s+(?<token>[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*getRequestAccessToken\(\s*request\s*\)/
  const tokenVariable = declarationPattern.exec(body)?.groups?.token
  if (!tokenVariable) {
    return null
  }
  const occurrences = body.split('getRequestAccessToken(').length - 1
  return occurrences === 1 ? tokenVariable : null
}

function hasBearerTokenCapture(literal) {
  if (literal === null || !/^\/\^Bearer\\s\+\(/.test(literal)) {
    return false
  }
  return !/^\/\^Bearer\\s\+\(\?(?::|=|!|<=|<!)/.test(literal)
}

export { readModelWorkerHttpFacts }
