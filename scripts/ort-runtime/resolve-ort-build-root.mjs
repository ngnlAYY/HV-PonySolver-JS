import { lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, parse, resolve } from 'node:path'

const SAFE_DIRECTORY_PATTERN = /^hv-pony-ort-[A-Za-z0-9][A-Za-z0-9._-]*$/

function resolveThroughExistingAncestor(candidate) {
  let cursor = candidate
  const missingSegments = []
  while (true) {
    try {
      return join(realpathSync.native(cursor), ...missingSegments)
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error
      const parent = dirname(cursor)
      if (parent === cursor) throw error
      missingSegments.unshift(basename(cursor))
      cursor = parent
    }
  }
}

export function resolveOrtBuildRoot(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('unsafe ORT build root: path is empty')
  }
  const candidate = resolve(value)
  if (lstatSync(candidate, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`unsafe ORT build root: symbolic link ${candidate}`)
  }
  const resolved = resolveThroughExistingAncestor(candidate)
  const root = parse(resolved).root
  if (resolved === root || resolved === resolve(homedir()) || !SAFE_DIRECTORY_PATTERN.test(basename(resolved))) {
    throw new Error(`unsafe ORT build root: ${resolved}`)
  }
  return resolved
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    process.stdout.write(`${resolveOrtBuildRoot(process.argv[2])}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
