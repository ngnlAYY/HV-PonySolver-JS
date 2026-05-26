import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workerDir = resolve(scriptDir, '..')
const templatePath = resolve(workerDir, 'wrangler.template.toml')
const outputPath = resolve(workerDir, 'wrangler.toml')

const requiredVariables = ['MODEL_KEYS_KV_NAMESPACE_ID', 'MODEL_BUCKET_NAME']
const productionModes = new Set(['production', 'deploy'])
const placeholderValues = new Set(['test-kv', 'test-bucket'])
const renderMode = process.env.HV_PONY_SOLVER_RENDER_ENV || ''

function isProductionMode() {
  return productionModes.has(renderMode)
}

function readRequiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required to render apps/model-worker/wrangler.toml`)
  }
  if (isProductionMode() && placeholderValues.has(value)) {
    throw new Error(`${name} must not use test placeholder value in production mode`)
  }
  return value
}

function replacePlaceholders(template) {
  return requiredVariables.reduce((content, name) => {
    return content.replaceAll('${' + name + '}', readRequiredEnv(name))
  }, template)
}

const template = await readFile(templatePath, 'utf8')
const rendered = replacePlaceholders(template)
await writeFile(outputPath, rendered)
