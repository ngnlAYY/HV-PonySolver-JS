import { readModelWorkerHttpFacts } from './model-worker-source-facts.mjs'

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

export { checkModelWorkerDocs, readModelWorkerHttpFacts }
