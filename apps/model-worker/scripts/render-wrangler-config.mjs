import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertNoUnresolvedPlaceholders,
  isProductionMode,
  requiredVariables,
  validateConfigValue,
} from './wrangler-config-guard.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workerDir = resolve(scriptDir, '..')
const templatePath = resolve(workerDir, 'wrangler.template.toml')
const outputPath = resolve(workerDir, 'wrangler.toml')
const renderMode = process.env.HV_PONY_SOLVER_RENDER_ENV || ''

function readRequiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required to render apps/model-worker/wrangler.toml`)
  }
  return validateConfigValue(name, value, { allowTestPlaceholders: !isProductionMode(renderMode) })
}

function replacePlaceholders(template) {
  return requiredVariables.reduce((content, name) => {
    return content.replaceAll('${' + name + '}', readRequiredEnv(name))
  }, template)
}

const template = await readFile(templatePath, 'utf8')
const rendered = replacePlaceholders(template)
assertNoUnresolvedPlaceholders(rendered, 'apps/model-worker/wrangler.toml')
await writeFile(outputPath, rendered)
