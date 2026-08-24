import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateRenderedWranglerConfig } from './wrangler-config-guard.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workerDir = resolve(scriptDir, '..')
const wranglerPath = resolve(workerDir, 'wrangler.toml')

try {
  const wranglerConfig = await readFile(wranglerPath, 'utf8')
  validateRenderedWranglerConfig(wranglerConfig)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
