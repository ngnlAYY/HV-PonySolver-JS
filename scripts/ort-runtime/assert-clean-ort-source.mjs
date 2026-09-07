#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function assertCleanOrtSourceOutputs(worktreeStatus, submoduleStatus) {
  if (worktreeStatus.trim().length > 0) {
    throw new Error('ONNX Runtime source checkout is not clean; use a fresh dedicated ORT build root')
  }
  const invalidSubmodule = submoduleStatus.split(/\r?\n/).find((line) => line.length > 0 && line[0] !== ' ')
  if (invalidSubmodule) {
    throw new Error('ONNX Runtime submodule state is not pinned and initialized')
  }
}

export function assertCleanOrtSource(sourceDirectory) {
  const worktreeStatus = execFileSync(
    'git',
    ['-C', sourceDirectory, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'],
    { encoding: 'utf8' },
  )
  const submoduleStatus = execFileSync('git', ['-C', sourceDirectory, 'submodule', 'status', '--recursive'], {
    encoding: 'utf8',
  })
  assertCleanOrtSourceOutputs(worktreeStatus, submoduleStatus)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sourceDirectory = process.argv[2]
  if (!sourceDirectory || process.argv.length !== 3) {
    process.stderr.write('Usage: assert-clean-ort-source.mjs <onnxruntime-source-directory>\n')
    process.exitCode = 2
  } else {
    try {
      assertCleanOrtSource(sourceDirectory)
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }
  }
}
