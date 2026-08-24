import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Unified direct-execution guard: true when the module was the Node entry point.
// Pass import.meta.url explicitly so each caller is compared against its own module URL.
export function isDirectRun(moduleUrl = import.meta.url, argvPath = process.argv[1]) {
  return Boolean(argvPath) && resolve(argvPath) === fileURLToPath(moduleUrl)
}
