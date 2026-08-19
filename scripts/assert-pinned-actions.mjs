#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflowsDirectory = join(repositoryRoot, '.github', 'workflows')
const externalActionPattern = /^\s*uses:\s*([^\s#]+)/
const commitShaPattern = /^[0-9a-f]{40}$/
const violations = []

for (const workflowName of readdirSync(workflowsDirectory).sort()) {
  if (!/\.(?:yml|yaml)$/.test(workflowName)) continue

  const workflowPath = join(workflowsDirectory, workflowName)
  const lines = readFileSync(workflowPath, 'utf8').split(/\r?\n/)

  lines.forEach((line, index) => {
    const match = line.match(externalActionPattern)
    if (!match || match[1].startsWith('./') || match[1].startsWith('../')) return

    const atIndex = match[1].lastIndexOf('@')
    const sha = atIndex === -1 ? '' : match[1].slice(atIndex + 1)
    if (!commitShaPattern.test(sha)) {
      violations.push(`${join('.github', 'workflows', workflowName)}:${index + 1}: ${match[1]}`)
    }
  })
}

if (violations.length > 0) {
  process.stderr.write('External GitHub Actions must be pinned to a full 40-character commit SHA:\n')
  for (const violation of violations) process.stderr.write(`- ${violation}\n`)
  process.exitCode = 1
} else {
  process.stdout.write('All external GitHub Actions are pinned to full commit SHAs.\n')
}
