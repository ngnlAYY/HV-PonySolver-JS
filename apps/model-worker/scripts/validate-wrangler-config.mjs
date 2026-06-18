import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateRenderedWranglerConfig } from './wrangler-config-guard.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workerDir = resolve(scriptDir, '..')
const wranglerPath = resolve(workerDir, 'wrangler.toml')

const wranglerConfig = await readFile(wranglerPath, 'utf8')
validateRenderedWranglerConfig(wranglerConfig)
