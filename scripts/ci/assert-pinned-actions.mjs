#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const workflowsDirectory = join(repositoryRoot, '.github', 'workflows')
const externalActionKeyPattern =
  /(?:^[ \t]*(?:-[ \t]*)?|[{,][ \t]*)(?:(?:"uses"|'uses')[ \t]*:|uses[ \t]*:(?=[ \t]|$))[ \t]*/g
const explicitExternalActionKeyPattern = /^[ \t]*(?:-[ \t]*)?\?[ \t]*(?:"uses"|'uses'|uses)[ \t]*(?:#.*)?$/
const withMappingKeyPattern = /^[ \t]*(?:(?:"with"|'with')[ \t]*:|with[ \t]*:(?=[ \t]|$))[ \t]*(.*)$/
const credentialMappingKeyPattern =
  /^[ \t]*(?:(?:"persist-credentials"|'persist-credentials')[ \t]*:|persist-credentials[ \t]*:(?=[ \t]|$))[ \t]*(.*)$/
const commitShaPattern = /^[0-9a-f]{40}$/
const dockerDigestPattern = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/
const violations = []

function parseScalar(value) {
  const trimmed = value.trimStart()
  if (trimmed.length === 0 || trimmed.startsWith('#')) return null
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    const token = trimmed.match(/^(?:"(?:\\.|[^"\\\r\n])*"|'(?:''|[^'\r\n])*')/u)?.[0]
    if (!token) return null
    const remainder = trimmed.slice(token.length).trimStart()
    if (remainder && !/^[#,}\]]/u.test(remainder)) return null
    try {
      return decodeQuotedScalar(token)
    } catch {
      return null
    }
  }
  return trimmed.split(/[,}\]]|\s+#/u, 1)[0].trimEnd() || null
}

// Keep scalar text out of the scanner without treating quoted mapping keys as comments.
function codeMask(line, state = { quote: null, flowDepth: 0 }) {
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
      (index === 0 || /[:[,?{-]$/u.test(line.slice(0, index).trimEnd()) || !line.slice(0, index).trim())
    ) {
      state.quote = character
    } else if (character === '#' && (index === 0 || /\s/u.test(line[index - 1]))) {
      mask.fill(false, index)
      break
    } else if (character === '{' || character === '[') {
      state.flowDepth += 1
    } else if (character === '}' || character === ']') {
      state.flowDepth -= 1
    } else if (character === ':') {
      const start = index + 1 + (line.slice(index + 1).match(/^[ \t]*/u)?.[0].length ?? 0)
      const first = line[start]
      if (!first || /["'[{#|>]/u.test(first)) continue
      if (/[&*!]/u.test(first)) state.unsupported = true
      // A plain scalar is data. Braces and action-like tokens inside a shell
      // command/name must not manufacture additional mapping keys.
      let end = start
      while (end < line.length && (state.flowDepth === 0 || !/[,}\]]/u.test(line[end]))) end += 1
      mask.fill(false, start, end)
      if (state.flowDepth === 0) state.plainScalar = true
      index = end - 1
    }
  }
  return mask
}

function workflowCodeMasks(lines, onUnsupported = () => undefined) {
  const state = { quote: null, flowDepth: 0 }
  let blockIndent = null
  let plainIndent = null
  return lines.map((line, index) => {
    const indent = line.match(/^[ \t]*/u)[0].length
    if (plainIndent !== null) {
      if (!line.trim() || indent > plainIndent) return Array(line.length).fill(false)
      plainIndent = null
    }
    if (blockIndent !== null) {
      if (!line.trim() || indent > blockIndent) return Array(line.length).fill(false)
      blockIndent = null
    }
    state.plainScalar = false
    state.unsupported = false
    const mask = codeMask(line, state)
    if (state.unsupported || (mask[line.search(/\S/u)] && /^[ \t]*(?:-[ \t]*)?(?:\?[ \t]*)?[&*!]/u.test(line))) {
      onUnsupported(index)
    }
    if (state.plainScalar) plainIndent = indent + (/^[ \t]*-[ \t]+/u.test(line) ? 2 : 0)
    const code = line
      .split('')
      .map((character, index) => (mask[index] ? character : ' '))
      .join('')
    if (/:[ \t]*[|>][1-9+-]*[ \t]*$/u.test(code)) blockIndent = indent
    return mask
  })
}

function decodeQuotedScalar(token) {
  if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'")
  const escapes = {
    0: '\0',
    a: '\x07',
    b: '\b',
    t: '\t',
    n: '\n',
    v: '\v',
    f: '\f',
    r: '\r',
    e: '\x1b',
    ' ': ' ',
    '"': '"',
    '/': '/',
    '\\': '\\',
    N: '\u0085',
    _: '\u00a0',
    L: '\u2028',
    P: '\u2029',
  }
  return token.slice(1, -1).replace(/\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/gu, (escape) => {
    if (/^\\[xuU]/u.test(escape)) {
      const codePoint = Number.parseInt(escape.slice(2), 16)
      if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff))
        throw new Error('unsupported mapping key escape')
      return String.fromCodePoint(codePoint)
    }
    if (!Object.hasOwn(escapes, escape[1])) throw new Error('unsupported mapping key escape')
    return escapes[escape[1]]
  })
}

function normalizeMappingKeys(lines, workflowName) {
  const masks = workflowCodeMasks(lines, (index) => {
    violations.push(`${workflowName}:${index + 1}: unsupported YAML anchor, alias, or tag`)
  })
  return lines.map((line, index) => {
    const replacements = []
    const prefixes = /(?:^[ \t]*(?:-[ \t]*)?(?:\?[ \t]*)?|[{,][ \t]*)/gu
    for (const prefix of line.matchAll(prefixes)) {
      if (!masks[index][prefix.index]) continue
      const start = prefix.index + prefix[0].length
      if (line[start] !== '"' && line[start] !== "'") continue
      const token = line.slice(start).match(/^(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*')/u)?.[0]
      if (!token) {
        violations.push(`${workflowName}:${index + 1}: unsupported multiline quoted mapping key`)
        continue
      }
      const rest = line.slice(start + token.length).trimStart()
      if (!rest.startsWith(':') && !(prefix[0].includes('?') && (!rest || rest.startsWith('#')))) continue
      try {
        replacements.push({ start, end: start + token.length, value: JSON.stringify(decodeQuotedScalar(token)) })
      } catch (error) {
        violations.push(`${workflowName}:${index + 1}: ${error.message}`)
      }
    }
    for (const replacement of replacements.reverse()) {
      line = line.slice(0, replacement.start) + replacement.value + line.slice(replacement.end)
    }
    return line
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
  const mask = codeMask(source, { quote: null, flowDepth: 1 })
  const fields = []
  let depth = 0
  let start = 0
  for (let index = 0; index <= source.length; index += 1) {
    if (index < source.length && !mask[index]) continue
    const character = source[index]
    if (character === '{' || character === '[') depth += 1
    else if (character === '}' || character === ']') depth -= 1
    if ((character === ',' && depth === 0) || index === source.length) {
      const field = source
        .slice(start, index)
        .match(/^\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^:\s]+)(?=[ \t]*:(?:[ \t]|$)))\s*:\s*([\s\S]*)$/u)
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

function actionStepBounds(lines, actionLineIndex, masks) {
  for (let start = actionLineIndex; start >= 0; start -= 1) {
    if (!masks[start][lines[start].search(/\S/u)]) continue
    const stepMatch = lines[start].match(/^([ \t]*)-[ \t]+/)
    if (!stepMatch) continue
    const indentation = stepMatch[1]
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (!masks[index][lines[index].search(/\S/u)]) continue
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
  const { start, end } = actionStepBounds(lines, actionLineIndex, masks)
  const stepKeyIndent = lines[start].match(/^[ \t]*-[ \t]+/u)?.[0].length
  const withPattern = withMappingKeyPattern
  const credentialPattern = credentialMappingKeyPattern
  const values = []

  for (let index = start; index < end; index += 1) {
    const line = lines[index]
    if (!masks[index][line.search(/\S/u)]) continue
    const withMatch = line.match(withPattern)
    if (!withMatch) continue
    const withIndent = line.match(/^[ \t]*/)?.[0].length ?? 0
    if (withIndent !== stepKeyIndent) continue
    const inlineValue = withMatch[1].trim()
    const inlineMapping = inlineValue.startsWith('{')
      ? enclosingFlowMapping(inlineValue, 0, codeMask(inlineValue))
      : null
    if (inlineMapping !== null) {
      for (const field of flowMappingFields(inlineMapping)) {
        if (field.key === 'persist-credentials') values.push(parseScalar(field.value))
      }
    }

    let inputIndent = null
    for (let child = index + 1; child < end; child += 1) {
      const childLine = lines[child]
      if (!masks[child][childLine.search(/\S/u)]) continue
      const childIndent = childLine.match(/^[ \t]*/)?.[0].length ?? 0
      if (childIndent <= withIndent) break
      inputIndent ??= childIndent
      if (childIndent !== inputIndent) continue
      const credentialMatch = childLine.match(credentialPattern)
      if (credentialMatch) values.push(parseScalar(credentialMatch[1]))
    }
  }

  return values.length === 1 && values[0] === 'false'
}

for (const workflowName of readdirSync(workflowsDirectory).sort()) {
  if (!/\.(?:yml|yaml)$/.test(workflowName)) continue

  const workflowPath = join(workflowsDirectory, workflowName)
  const lines = normalizeMappingKeys(readFileSync(workflowPath, 'utf8').split(/\r?\n/), workflowName)

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
