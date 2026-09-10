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

  checkPreflightDocs(
    errors,
    findModelWorkerHttpRow(lines, 'OPTIONS', '/yolo26n-640.onnx'),
    'model',
    facts.allowedMethods,
    facts.modelAllowedHeaders,
  )
  checkPreflightDocs(
    errors,
    findModelWorkerHttpRow(lines, 'OPTIONS', '/quota'),
    'quota',
    facts.quotaAllowedMethods,
    facts.quotaAllowedHeaders,
  )
  checkPreflightDocs(
    errors,
    findModelWorkerHttpRow(lines, 'OPTIONS', '/runtime/'),
    'runtime',
    facts.allowedMethods,
    null,
  )

  const methodNotAllowedLine = findMethodNotAllowedDocsLine(lines)
  if (facts.allowedMethods && !lineMentionsHeaderValue(methodNotAllowedLine, 'Allow', facts.allowedMethods)) {
    errors.push(
      `README.md Model Worker HTTP 405 docs must mention Allow: ${facts.allowedMethods} on the method-not-allowed row`,
    )
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
  if (
    facts.selectedObjectMissingStatus &&
    facts.selectedObjectMissingMessage &&
    !selectedObjectMissingLine.includes(`${facts.selectedObjectMissingStatus} ${facts.selectedObjectMissingMessage}`)
  ) {
    errors.push(
      `README.md Model Worker selected R2 object missing docs must mention ${facts.selectedObjectMissingStatus} ${facts.selectedObjectMissingMessage}`,
    )
  }

  if (lines.some((line) => line.includes('Cache-Control: public, max-age=86400'))) {
    errors.push(
      'README.md Model Worker HTTP docs must not document stale Cache-Control: public, max-age=86400 semantics',
    )
  }

  return errors
}

function checkModelWorkerOpsDocs(opsDoc, readme, deploymentWorkflowSource) {
  const errors = []
  const workflowPath = '.github/workflows/deploy-cloudflare-model-worker.yml'
  const renderStep = findUniqueWorkflowStep(deploymentWorkflowSource, 'Render Wrangler config', workflowPath, errors)
  const dryRunStep = findUniqueWorkflowStep(deploymentWorkflowSource, 'Wrangler dry-run', workflowPath, errors)
  const deployStep = findUniqueWorkflowStep(deploymentWorkflowSource, 'Deploy Worker', workflowPath, errors)
  const requireSecretsStep = findUniqueWorkflowStep(
    deploymentWorkflowSource,
    'Require Cloudflare secrets for deployment',
    workflowPath,
    errors,
  )
  const deployJob = findUniqueWorkflowJob(deploymentWorkflowSource, 'deploy', workflowPath, errors)
  const readyCondition = "steps.cloudflare_secrets.outputs.ready == 'true'"

  if (!deploymentWorkflowSource.includes('skipping Wrangler dry-run and deploy')) {
    errors.push(`${workflowPath} must explicitly report when missing secrets skip Wrangler dry-run and deploy`)
  }
  for (const variable of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'MODEL_KEYS_KV_NAMESPACE_ID',
    'MODEL_BUCKET_NAME',
  ]) {
    const normalizedValue = '${' + variable + '//[[:space:]]/}'
    if (!deploymentWorkflowSource.includes(normalizedValue)) {
      errors.push(`${workflowPath} must treat whitespace-only values as incomplete secrets (${variable})`)
    }
  }
  if (!renderStep.includes(readyCondition) || !dryRunStep.includes(readyCondition)) {
    errors.push(`${workflowPath} must gate deploy config rendering and Wrangler dry-run on complete secrets`)
  }
  if (!deployStep.includes('inputs.publish_model_worker') || !deployStep.includes(readyCondition)) {
    errors.push(`${workflowPath} must gate deployment on publish intent and complete secrets`)
  }
  if (!deployStep.includes("github.ref == 'refs/heads/main'")) {
    errors.push(`${workflowPath} deployment must require github.ref == 'refs/heads/main'`)
  }
  if (!/^ {4}if:\s*\$\{\{[^\n]*github\.ref\s*==\s*'refs\/heads\/main'[^\n]*\}\}\s*$/mu.test(deployJob)) {
    errors.push(`${workflowPath} deployment job must require github.ref == 'refs/heads/main' before reading secrets`)
  }
  if (!/^\s{4}environment:\s*production-model-worker\s*$/m.test(deployJob)) {
    errors.push(`${workflowPath} deploy job must use the production-model-worker environment`)
  }
  if (
    !requireSecretsStep.includes('inputs.publish_model_worker') ||
    !requireSecretsStep.includes("steps.cloudflare_secrets.outputs.ready != 'true'")
  ) {
    errors.push(`${workflowPath} must fail closed when deployment is requested without complete secrets`)
  }

  if (!opsDoc.includes(workflowPath)) {
    errors.push(`docs/model-worker-ops.md must name ${workflowPath}`)
  }
  if (/^MODEL_WORKER_PROBE_ID=<[^>\n]+>\s*\\?$/mu.test(opsDoc)) {
    errors.push('docs/model-worker-ops.md MODEL_WORKER_PROBE_ID example must be directly executable')
  }
  checkSecretGateDocs(errors, opsDoc, 'docs/model-worker-ops.md', true)
  checkSecretGateDocs(errors, readme, 'README.md', false)
  return errors
}

function checkModelCacheStrategyDocs(cacheDoc, facts) {
  const requiredTerms = [
    `Cache-Control: ${facts.cacheControl}`,
    'Authorization: Bearer',
    'IndexedDB',
    'GET /quota',
    'POST /quota',
    'MODEL_DOWNLOAD_QUOTA_ENABLED=false',
    '`429`',
    '`503`',
  ]
  return requiredTerms.flatMap((term) =>
    cacheDoc.includes(term) ? [] : [`docs/model-cache-strategy.md model cache contract must mention ${term}`],
  )
}

function checkSecretGateDocs(errors, document, label, requirePublishDetails) {
  const lines = document.split(/\r?\n/)
  const secretlessSkipLine = lines.find(
    (line) =>
      /Cloudflare secrets 不完整/.test(line) &&
      /publish_model_worker=false/.test(line) &&
      /跳过/.test(line) &&
      /dry-run/.test(line) &&
      /(?:部署|deploy)/i.test(line),
  )
  if (!secretlessSkipLine) {
    errors.push(`${label} missing-secrets contract must state that secrets skip Wrangler dry-run and deploy`)
  } else if (!/typecheck/.test(secretlessSkipLine) || !/测试/.test(secretlessSkipLine)) {
    errors.push(`${label} missing-secrets contract must state that typecheck and tests still run`)
  }
  if (
    requirePublishDetails &&
    !lines.some(
      (line) => /publish_model_worker=true/.test(line) && /secrets 不完整/.test(line) && /fail closed/i.test(line),
    )
  ) {
    errors.push(`${label} must state that publishing without complete secrets fails closed`)
  }
}

function findUniqueWorkflowStep(source, name, workflowPath, errors) {
  const steps = findWorkflowSteps(source, name)
  if (steps.length !== 1) {
    errors.push(`${workflowPath} must define exactly one workflow step named ${name}`)
    return ''
  }
  return steps[0]
}

function findWorkflowSteps(source, name) {
  const lines = source.split(/\r?\n/)
  const steps = []
  for (let start = 0; start < lines.length; start += 1) {
    if (lines[start].trim() !== `- name: ${name}`) {
      continue
    }
    const indentation = lines[start].match(/^\s*/)?.[0] ?? ''
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      const currentIndent = lines[index].match(/^\s*/)?.[0].length ?? 0
      if (lines[index].trim().length > 0 && currentIndent < indentation.length) {
        end = index
        break
      }
      const sameLevelSource = lines[index].slice(indentation.length)
      if (lines[index].startsWith(indentation) && /^-\s+/.test(sameLevelSource)) {
        end = index
        break
      }
    }
    steps.push(lines.slice(start, end).join('\n'))
  }
  return steps
}

function findUniqueWorkflowJob(source, name, workflowPath, errors) {
  const lines = source.split(/\r?\n/)
  const jobHeader = `  ${name}:`
  const jobs = []
  for (let start = 0; start < lines.length; start += 1) {
    if (lines[start] !== jobHeader) continue
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
        end = index
        break
      }
      if (lines[index].trim().length > 0 && !lines[index].startsWith('  ')) {
        end = index
        break
      }
    }
    jobs.push(lines.slice(start, end).join('\n'))
  }
  if (jobs.length !== 1) {
    errors.push(`${workflowPath} must define exactly one workflow job named ${name}`)
    return ''
  }
  return jobs[0]
}

function checkPreflightDocs(errors, line, routeName, allowMethods, allowHeaders) {
  if (allowMethods && !lineMentionsHeaderValue(line, 'Access-Control-Allow-Methods', allowMethods)) {
    errors.push(
      `README.md Model Worker ${routeName} OPTIONS docs must mention Access-Control-Allow-Methods: ${allowMethods}`,
    )
  }
  if (allowHeaders && !lineMentionsHeaderValue(line, 'Access-Control-Allow-Headers', allowHeaders)) {
    errors.push(
      `README.md Model Worker ${routeName} OPTIONS docs must mention Access-Control-Allow-Headers: ${allowHeaders}`,
    )
  }
  if (!allowHeaders && line.includes('Access-Control-Allow-Headers')) {
    errors.push(`README.md Model Worker ${routeName} OPTIONS docs must not document request headers`)
  }
}

function findModelWorkerHttpRow(lines, method, pathPrefix = '/') {
  const rowPattern = /^\|\s*`([^`]*)`/
  for (const line of lines) {
    const match = rowPattern.exec(line)
    const request = match?.[1]
    if (!request) continue
    const separator = request.search(/\s/u)
    if (separator < 0 || request.slice(0, separator) !== method) continue
    if (request.slice(separator).trimStart().startsWith(pathPrefix)) return line
  }
  return ''
}

function findMethodNotAllowedDocsLine(lines) {
  return lines.find(isMethodNotAllowedDocsLine) ?? ''
}

function lineMentionsHeaderValue(line, headerName, value) {
  const headerValue = `${headerName}: ${value}`
  if (line.includes(`\`${headerValue}\``)) return true
  for (
    let index = line.indexOf(headerValue);
    index >= 0;
    index = line.indexOf(headerValue, index + headerValue.length)
  ) {
    const next = line[index + headerValue.length]
    if (next === undefined || /[\s，。;；|)]/u.test(next)) return true
  }
  return false
}

function isMethodNotAllowedDocsLine(line) {
  return /^\|\s*非\s+`GET`\s*\/\s*`HEAD`\s*\/\s*`OPTIONS`\s+方法\s*\|/.test(line)
}

function hasStaleMethodAllowHeader(line) {
  return /Allow: GET, HEAD(?!, OPTIONS)/.test(line)
}

function isQueryStringKeyDocsLine(line) {
  return /(?:query[-\s]+string\s+key|key\s+query\s+string|query\s+param(?:eter)?\s+key|search\s+param(?:eter)?\s+key|url\s+param(?:eter)?\s+key|[?&]key=)/i.test(
    line,
  )
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
    .replace(
      new RegExp(
        String.raw`\b${denial}\s+(?:authori[sz]es?|returns?|serves?)\s+(?:access\s+to\s+)?${realModel}\b`,
        'gi',
      ),
      '',
    )
    .replace(new RegExp(String.raw`\b${denial}\s+grants?\s+(?:access\s+to\s+)?${realModel}\b`, 'gi'), '')
    .replace(/\b(?:while|but)\s+(?:Authorization:\s*)?Bearer(?:\s+token)?\b[^.;。；]*/gi, '')
    .replace(/,\s*(?:Authorization:\s*)?Bearer(?:\s+token)?\b[^.;。；]*/gi, '')
}

function queryStringSegmentAuthorizesRealModel(line) {
  return /(?:授权真实模型|(?:会|可)?返回\s*(?:`?200`?\s*)?真实模型|returns?\s+(?:(?:`?200`?|\d{3})[\s,，]*)?(?:a\s+|the\s+)?real model|serves?\s+(?:a\s+|the\s+)?real model|authori[sz]es?\s+(?:access\s+to\s+)?(?:a\s+|the\s+)?real model|grants?\s+(?:access\s+to\s+)?(?:a\s+|the\s+)?real model|can\s+grant\s+access\s+to\s+(?:a\s+|the\s+)?real model|200\s*(?:真实模型|real model))/i.test(
    line,
  )
}

function isSelectedObjectMissingDocsLine(line) {
  return /^\|\s*选中的 R2 object 缺失\s*\|/.test(line)
}

export { checkModelCacheStrategyDocs, checkModelWorkerDocs, checkModelWorkerOpsDocs, readModelWorkerHttpFacts }
