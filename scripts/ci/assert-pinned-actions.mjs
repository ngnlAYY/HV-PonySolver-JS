#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const workflowsDirectory = join(repositoryRoot, '.github', 'workflows')
const externalActionKeyPattern = /(?:^[ \t]*(?:-[ \t]*)?|[{,][ \t]*)(?:"uses"|'uses'|uses)[ \t]*:[ \t]*/g
const explicitExternalActionKeyPattern = /^[ \t]*(?:-[ \t]*)?\?[ \t]*(?:"uses"|'uses'|uses)[ \t]*(?:#.*)?$/
const withMappingKeyPattern = /^[ \t]*(?:"with"|'with'|with)[ \t]*:[ \t]*(.*)$/
const credentialMappingKeyPattern =
  /^[ \t]*(?:"persist-credentials"|'persist-credentials'|persist-credentials)[ \t]*:[ \t]*(.*)$/
const commitShaPattern = /^[0-9a-f]{40}$/
const dockerDigestPattern = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/
const violations = []

function parseScalar(value) {
  const trimmed = value.trimStart()
  if (trimmed.length === 0 || trimmed.startsWith('#')) return null
  if (trimmed.startsWith('"')) {
    const match = trimmed.match(/^"([^"\r\n]+)"/)
    return match?.[1] ?? null
  }
  if (trimmed.startsWith("'")) {
    const match = trimmed.match(/^'([^'\r\n]+)'/)
    return match?.[1] ?? null
  }
  return trimmed.match(/^([^\s,#}]+)/)?.[1] ?? null
}

// Keep scalar text out of the scanner without treating quoted mapping keys as comments.
function codeMask(line, state = { quote: null }) {
  const mask = Array(line.length).fill(true)
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (state.quote) {
      mask[index] = false
      if (character === '\\' && state.quote === '"') {
        if (index + 1 < line.length) mask[++index] = false
      } else if (character === state.quote) {
        if (state.quote === "'" && line[index + 1] === "'") mask[++index] = false
        else state.quote = null
      }
    } else if (
      (character === '"' || character === "'") &&
      (index === 0 || /[:[,{-]$/u.test(line.slice(0, index).trimEnd()) || !line.slice(0, index).trim())
    ) {
      state.quote = character
    } else if (character === '#' && (index === 0 || /\s/u.test(line[index - 1]))) {
      mask.fill(false, index)
      break
    }
  }
  return mask
}

function workflowCodeMasks(lines) {
  const state = { quote: null }
  let blockIndent = null
  return lines.map((line) => {
    const indent = line.match(/^[ \t]*/u)[0].length
    if (blockIndent !== null) {
      if (!line.trim() || indent > blockIndent) return Array(line.length).fill(false)
      blockIndent = null
    }
    const mask = codeMask(line, state)
    const code = line
      .split('')
      .map((character, index) => (mask[index] ? character : ' '))
      .join('')
    if (/:[ \t]*[|>][1-9+-]*[ \t]*$/u.test(code)) blockIndent = indent
    return mask
  })
}

function enclosingFlowMapping(line, position, mask) {
  const stack = []
  for (let index = 0; index < line.length; index += 1) {
    if (!mask[index]) continue
    if (line[index] === '{') stack.push(index)
    else if (line[index] === '}') {
      const start = stack.pop()
      if (start !== undefined && start <= position && position < index) return line.slice(start + 1, index)
    }
  }
  return null
}

function flowMappingFields(source) {
  const mask = codeMask(source)
  const fields = []
  let depth = 0
  let start = 0
  for (let index = 0; index <= source.length; index += 1) {
    if (index < source.length && !mask[index]) continue
    const character = source[index]
    if (character === '{' || character === '[') depth += 1
    else if (character === '}' || character === ']') depth -= 1
    if ((character === ',' && depth === 0) || index === source.length) {
      const field = source.slice(start, index).match(/^\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^:\s]+))\s*:\s*([\s\S]*)$/u)
      if (field) fields.push({ key: field[1] ?? field[2] ?? field[3], value: field[4] })
      start = index + 1
    }
  }
  return fields
}

function flowCheckoutDisablesCredentialPersistence(mapping) {
  const withFields = flowMappingFields(mapping).filter(({ key }) => key === 'with')
  if (withFields.length !== 1) return false
  const value = withFields[0].value.trim()
  if (!value.startsWith('{') || !value.endsWith('}')) return false
  const credentials = flowMappingFields(value.slice(1, -1)).filter(({ key }) => key === 'persist-credentials')
  return credentials.length === 1 && parseScalar(credentials[0].value) === 'false'
}

function nextIndentedScalar(lines, keyLineIndex) {
  const keyIndent = lines[keyLineIndex].match(/^[ \t]*/)?.[0].length ?? 0
  for (let index = keyLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0
    if (indent <= keyIndent) return null
    return parseScalar(line)
  }
  return null
}

function nextExplicitMappingScalar(lines, keyLineIndex) {
  const keyIndent = lines[keyLineIndex].match(/^[ \t]*/)?.[0].length ?? 0
  for (let index = keyLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0
    if (indent <= keyIndent) return null
    const valueMatch = line.match(/^[ \t]*:[ \t]*(.*)$/)
    if (!valueMatch) return null
    return parseScalar(valueMatch[1]) ?? nextIndentedScalar(lines, index)
  }
  return null
}

function actionStepBounds(lines, actionLineIndex) {
  for (let start = actionLineIndex; start >= 0; start -= 1) {
    const stepMatch = lines[start].match(/^([ \t]*)-[ \t]+/)
    if (!stepMatch) continue
    const indentation = stepMatch[1]
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (lines[index].startsWith(indentation) && /^-[ \t]+/.test(lines[index].slice(indentation.length))) {
        end = index
        break
      }
      const currentIndent = lines[index].match(/^[ \t]*/)?.[0].length ?? 0
      if (lines[index].trim().length > 0 && currentIndent < indentation.length) {
        end = index
        break
      }
    }
    return { start, end }
  }
  return { start: actionLineIndex, end: actionLineIndex + 1 }
}

function checkoutDisablesCredentialPersistence(lines, actionLineIndex, masks) {
  const { start, end } = actionStepBounds(lines, actionLineIndex)
  const withPattern = withMappingKeyPattern
  const credentialPattern = credentialMappingKeyPattern
  const values = []

  for (let index = start; index < end; index += 1) {
    const line = lines[index]
    if (!masks[index][line.search(/\S/u)]) continue
    const withMatch = line.match(withPattern)
    if (!withMatch) continue
    const withIndent = line.match(/^[ \t]*/)?.[0].length ?? 0
    const inlineValue = withMatch[1].trim()
    const inlineMapping = inlineValue.startsWith('{')
      ? enclosingFlowMapping(inlineValue, 0, codeMask(inlineValue))
      : null
    if (inlineMapping !== null) {
      for (const field of flowMappingFields(inlineMapping)) {
        if (field.key === 'persist-credentials') values.push(parseScalar(field.value))
      }
    }

    for (let child = index + 1; child < end; child += 1) {
      const childLine = lines[child]
      if (!masks[child][childLine.search(/\S/u)]) continue
      const childIndent = childLine.match(/^[ \t]*/)?.[0].length ?? 0
      if (childIndent <= withIndent) break
      const credentialMatch = childLine.match(credentialPattern)
      if (credentialMatch) values.push(parseScalar(credentialMatch[1]))
    }
  }

  return values.length === 1 && values[0] === 'false'
}

for (const workflowName of readdirSync(workflowsDirectory).sort()) {
  if (!/\.(?:yml|yaml)$/.test(workflowName)) continue

  const workflowPath = join(workflowsDirectory, workflowName)
  const lines = readFileSync(workflowPath, 'utf8').split(/\r?\n/)

  const masks = workflowCodeMasks(lines)
  lines.forEach((line, index) => {
    const mask = masks[index]
    const matches = [...line.matchAll(externalActionKeyPattern)].filter((match) => mask[match.index])
    const explicitMatch = line.match(explicitExternalActionKeyPattern)
    if (explicitMatch && mask[line.search(/\S/u)]) matches.push(explicitMatch)
    for (const match of matches) {
      const reference =
        match === explicitMatch
          ? nextExplicitMappingScalar(lines, index)
          : (parseScalar(line.slice(match.index + match[0].length)) ?? nextIndentedScalar(lines, index))
      if (reference === null) {
        violations.push(`${join('.github', 'workflows', workflowName)}:${index + 1}: missing or unsupported uses value`)
        continue
      }
      if (reference.startsWith('./') || reference.startsWith('../')) continue

      const atIndex = reference.lastIndexOf('@')
      const sha = atIndex === -1 ? '' : reference.slice(atIndex + 1)
      const pinned = reference.startsWith('docker://')
        ? dockerDigestPattern.test(reference)
        : commitShaPattern.test(sha)
      if (!pinned) {
        violations.push(`${join('.github', 'workflows', workflowName)}:${index + 1}: ${reference}`)
      }
      const mapping = enclosingFlowMapping(line, match.index + match[0].length - 1, mask)
      const credentialsDisabled =
        mapping === null
          ? checkoutDisablesCredentialPersistence(lines, index, masks)
          : flowCheckoutDisablesCredentialPersistence(mapping)
      if (/^actions\/checkout@/i.test(reference) && !credentialsDisabled) {
        violations.push(
          `${join('.github', 'workflows', workflowName)}:${index + 1}: checkout must set with.persist-credentials: false`,
        )
      }
    }
  })
}

if (violations.length > 0) {
  process.stderr.write('Workflow action security checks failed:\n')
  for (const violation of violations) process.stderr.write(`- ${violation}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('All external actions are pinned and checkout credentials are not persisted.\n')
}
