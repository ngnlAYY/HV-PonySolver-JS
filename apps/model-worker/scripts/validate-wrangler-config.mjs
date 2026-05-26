import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workerDir = resolve(scriptDir, '..')
const wranglerPath = resolve(workerDir, 'wrangler.toml')
const placeholderValues = ['test-kv', 'test-bucket']

const wranglerConfig = await readFile(wranglerPath, 'utf8')

for (const value of placeholderValues) {
  if (wranglerConfig.includes(`"${value}"`)) {
    throw new Error(`wrangler.toml must not contain test placeholder value: ${value}`)
  }
}
