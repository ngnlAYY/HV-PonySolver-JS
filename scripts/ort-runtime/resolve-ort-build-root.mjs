import { lstatSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

const SAFE_DIRECTORY_PATTERN = /^hv-pony-ort-[A-Za-z0-9][A-Za-z0-9._-]*$/
const repositoryRoot = resolve(import.meta.dirname, '../..')

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

function isWithin(candidate, directory) {
  const child = relative(directory, candidate)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

function assertOutsideProtectedPaths(candidate, initialCwd) {
  const [repository, cwd, home] = [repositoryRoot, initialCwd, homedir()].map((path) =>
    resolveThroughExistingAncestor(resolve(path)),
  )
  if (
    candidate === parse(candidate).root ||
    [repository, cwd, home].some((protectedPath) => isWithin(protectedPath, candidate)) ||
    isWithin(candidate, repository)
  ) {
    throw new Error(`unsafe ORT build path: protected directory ${candidate}`)
  }
}

export function resolveOrtBuildRoot(value, { initialCwd = process.cwd() } = {}) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('unsafe ORT build root: path is empty')
  }
  const candidate = resolve(value)
  if (lstatSync(candidate, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`unsafe ORT build root: symbolic link ${candidate}`)
  }
  const resolved = resolveThroughExistingAncestor(candidate)
  if (!SAFE_DIRECTORY_PATTERN.test(basename(resolved))) {
    throw new Error(`unsafe ORT build root: ${resolved}`)
  }
  assertOutsideProtectedPaths(resolved, initialCwd)
  return resolved
}

export function assertSafeOrtRemovalPath(value, buildRoot, options = {}) {
  const root = resolveOrtBuildRoot(buildRoot, options)
  const candidate = resolve(value)
  if (lstatSync(candidate, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error(`unsafe ORT removal path: symbolic link ${candidate}`)
  }
  const canonical = resolveThroughExistingAncestor(candidate)
  if (canonical !== candidate || canonical === root || !isWithin(canonical, root)) {
    throw new Error(`unsafe ORT removal path: ${candidate}`)
  }
  assertOutsideProtectedPaths(canonical, options.initialCwd ?? process.cwd())
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const [value, ...args] = process.argv.slice(2)
    const options = {}
    let removals = null
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === '--initial-cwd' && args[index + 1] && !options.initialCwd) {
        options.initialCwd = args[++index]
      } else if (args[index] === '--check-removal' && args[index + 1]) {
        removals = args.slice(index + 1)
        break
      } else {
        throw new Error(`unsupported ORT build path argument: ${args[index]}`)
      }
    }
    const root = resolveOrtBuildRoot(value, options)
    if (removals) {
      for (const target of removals) assertSafeOrtRemovalPath(target, root, options)
    } else {
      process.stdout.write(`${root}\n`)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
