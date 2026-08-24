import { escapeRegExp } from '../../../scripts/lib/strings.mjs'

const requiredVariables = ['MODEL_KEYS_KV_NAMESPACE_ID', 'MODEL_BUCKET_NAME']
const productionModes = new Set(['production', 'deploy'])
const placeholderValues = new Set(['test-kv', 'test-bucket'])
const unresolvedPlaceholderPattern = /\$\{[^}]+}/
const forbiddenTomlStringCharacterPattern = /["'`\\]/

const variableFormats = {
  MODEL_KEYS_KV_NAMESPACE_ID: {
    pattern: /^[0-9a-f]{32}$/,
    description: '32 位小写十六进制字符',
  },
  MODEL_BUCKET_NAME: {
    pattern: /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/,
    description: '3-63 位小写字母、数字或连字符，且首尾为字母或数字',
  },
}

const renderedAssignments = [
  ['MODEL_KEYS_KV_NAMESPACE_ID', 'id'],
  ['MODEL_BUCKET_NAME', 'bucket_name'],
]
const renderedResources = [
  ['kv_namespaces', 'MODEL_KEYS', 'id'],
  ['r2_buckets', 'MODEL_BUCKET', 'bucket_name'],
]
const invalidKeyModes = new Set(['decoy', 'error'])

function isProductionMode(renderMode) {
  return productionModes.has(renderMode)
}

function hasControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 32 || codePoint === 127) {
      return true
    }
  }
  return false
}

function assertNoUnresolvedPlaceholders(content, sourceName) {
  const match = content.match(unresolvedPlaceholderPattern)
  if (match) {
    throw new Error(`${sourceName} contains unresolved placeholder ${match[0]}`)
  }
}

function validateConfigValue(name, value, { allowTestPlaceholders = false } = {}) {
  if (hasControlCharacter(value)) {
    throw new Error(`${name} must not contain control characters`)
  }
  if (forbiddenTomlStringCharacterPattern.test(value)) {
    throw new Error(`${name} must not contain quotes or backslashes`)
  }
  if (placeholderValues.has(value)) {
    if (allowTestPlaceholders) {
      return value
    }
    throw new Error(`${name} must not use test placeholder value in production mode`)
  }

  const format = variableFormats[name]
  if (format && !format.pattern.test(value)) {
    throw new Error(`${name} must be ${format.description}`)
  }
  return value
}

function readTomlStringAssignmentValues(content, assignment, sourceName) {
  const escapedAssignment = escapeRegExp(assignment)
  const assignmentPattern = new RegExp(`^\\s*${escapedAssignment}\\s*=`)
  return content
    .split('\n')
    .filter((line) => assignmentPattern.test(line))
    .map((line) => {
      const match = line.match(new RegExp(`^\\s*${escapedAssignment}\\s*=\\s*"([^"]*)"\\s*$`))
      if (!match?.[1]) {
        throw new Error(`${sourceName} ${assignment} must be a quoted TOML string without extra content`)
      }
      return match[1]
    })
}

function readTomlStringAssignment(content, assignment, sourceName) {
  const values = readTomlStringAssignmentValues(content, assignment, sourceName)
  if (values.length === 0) {
    throw new Error(`${sourceName} must contain ${assignment}`)
  }
  if (values.length > 1) {
    throw new Error(`${sourceName} must contain exactly one ${assignment}`)
  }
  return values[0]
}

function readTomlArrayTableBlocks(content, tableName) {
  const escapedTableName = escapeRegExp(tableName)
  const tableHeaderPattern = new RegExp(`^\\s*\\[\\[\\s*${escapedTableName}\\s*\\]\\]\\s*$`)
  const anyTableHeaderPattern = /^\s*\[/
  const blocks = []
  let currentBlock = null

  for (const line of content.split('\n')) {
    if (tableHeaderPattern.test(line)) {
      if (currentBlock) {
        blocks.push(currentBlock.join('\n'))
      }
      currentBlock = [line]
      continue
    }
    if (currentBlock && anyTableHeaderPattern.test(line)) {
      blocks.push(currentBlock.join('\n'))
      currentBlock = null
      continue
    }
    currentBlock?.push(line)
  }

  if (currentBlock) {
    blocks.push(currentBlock.join('\n'))
  }
  return blocks
}

function validateRenderedResource(content, tableName, binding, assignment, sourceName) {
  const blocks = readTomlArrayTableBlocks(content, tableName)
  for (const block of blocks) {
    if (readTomlStringAssignmentValues(block, 'binding', sourceName).includes(binding)) {
      readTomlStringAssignment(block, assignment, sourceName)
      return
    }
  }
  throw new Error(`${sourceName} ${tableName} must contain binding = "${binding}" with ${assignment}`)
}

function validateRenderedInvalidKeyMode(content, sourceName) {
  const values = readTomlStringAssignmentValues(content, 'INVALID_KEY_MODE', sourceName)
  if (values.length === 0) {
    return
  }
  if (values.length > 1) {
    throw new Error(`${sourceName} must contain at most one INVALID_KEY_MODE`)
  }
  if (!invalidKeyModes.has(values[0].trim().toLowerCase())) {
    throw new Error(`${sourceName} INVALID_KEY_MODE must be one of: decoy, error`)
  }
}

function validateRenderedWranglerConfig(content, sourceName = 'wrangler.toml', { allowTestPlaceholders = false } = {}) {
  assertNoUnresolvedPlaceholders(content, sourceName)
  for (const [name, assignment] of renderedAssignments) {
    validateConfigValue(name, readTomlStringAssignment(content, assignment, sourceName), { allowTestPlaceholders })
  }
  validateRenderedInvalidKeyMode(content, sourceName)
  for (const [tableName, binding, assignment] of renderedResources) {
    validateRenderedResource(content, tableName, binding, assignment, sourceName)
  }
}

export {
  assertNoUnresolvedPlaceholders,
  isProductionMode,
  requiredVariables,
  validateConfigValue,
  validateRenderedWranglerConfig,
}
