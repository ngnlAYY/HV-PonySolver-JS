#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const workflowsDirectory = join(repositoryRoot, '.github', 'workflows')
const externalActionKeyPattern = /(?:^[ \t]*(?:-[ \t]*)?|[{,][ \t]*)(?:"uses"|'uses'|uses)[ \t]*:[ \t]*(.*)$/
const explicitExternalActionKeyPattern = /^[ \t]*(?:-[ \t]*)?\?[ \t]*(?:"uses"|'uses'|uses)[ \t]*(?:#.*)?$/
const mappingKeyPattern = (name) => new RegExp(`^[ \\t]*(?:"${name}"|'${name}'|${name})[ \\t]*:[ \\t]*(.*)$`)
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

function checkoutDisablesCredentialPersistence(lines, actionLineIndex) {
  const { start, end } = actionStepBounds(lines, actionLineIndex)
  const withPattern = mappingKeyPattern('with')
  const credentialPattern = mappingKeyPattern('persist-credentials')
  const values = []

  for (let index = start; index < end; index += 1) {
    const line = lines[index]
    if (line.trimStart().startsWith('#')) continue
    const withMatch = line.match(withPattern)
    if (!withMatch) continue
    const withIndent = line.match(/^[ \t]*/)?.[0].length ?? 0
    const inlineCredential = withMatch[1].match(
      /(?:^|[{,][ \t]*)(?:"persist-credentials"|'persist-credentials'|persist-credentials)[ \t]*:[ \t]*([^,}\s]+)/,
    )
    if (inlineCredential) values.push(parseScalar(inlineCredential[1]))

    for (let child = index + 1; child < end; child += 1) {
      const childLine = lines[child]
      if (childLine.trim().length === 0 || childLine.trimStart().startsWith('#')) continue
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

  lines.forEach((line, index) => {
    if (line.trimStart().startsWith('#')) return
    const match = line.match(externalActionKeyPattern)
    const explicitMatch = line.match(explicitExternalActionKeyPattern)
    if (!match && !explicitMatch) return

    const reference = match
      ? (parseScalar(match[1]) ?? nextIndentedScalar(lines, index))
      : nextExplicitMappingScalar(lines, index)
    if (reference === null) {
      violations.push(`${join('.github', 'workflows', workflowName)}:${index + 1}: missing or unsupported uses value`)
      return
    }
    if (reference.startsWith('./') || reference.startsWith('../')) return

    const atIndex = reference.lastIndexOf('@')
    const sha = atIndex === -1 ? '' : reference.slice(atIndex + 1)
    const pinned = reference.startsWith('docker://') ? dockerDigestPattern.test(reference) : commitShaPattern.test(sha)
    if (!pinned) {
      violations.push(`${join('.github', 'workflows', workflowName)}:${index + 1}: ${reference}`)
    }
    if (/^actions\/checkout@/i.test(reference) && !checkoutDisablesCredentialPersistence(lines, index)) {
      violations.push(
        `${join('.github', 'workflows', workflowName)}:${index + 1}: checkout must set with.persist-credentials: false`,
      )
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
