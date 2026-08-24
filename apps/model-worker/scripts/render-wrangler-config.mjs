import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWranglerConfigFile } from './wrangler-config-renderer.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workerDir = resolve(scriptDir, '..')

try {
  await renderWranglerConfigFile({
    templatePath: resolve(workerDir, 'wrangler.template.toml'),
    outputPath: resolve(workerDir, 'wrangler.toml'),
  })
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
