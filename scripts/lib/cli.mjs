import { resolve } from 'node:path'

// Shared CLI parsing for scripts that accept a single optional --repo-root <path> flag.
// Unknown arguments are rejected instead of being silently ignored, so typos fail fast.
export function parseRepoRootArgs(args, defaultRepoRoot) {
  let repoRoot = defaultRepoRoot
  let explicitRepoRoot = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg !== '--repo-root') {
      throw new Error(`Unknown argument: ${arg}`)
    }
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error('--repo-root requires a path')
    }
    repoRoot = resolve(value)
    explicitRepoRoot = true
    index += 1
  }

  return { repoRoot, explicitRepoRoot }
}
