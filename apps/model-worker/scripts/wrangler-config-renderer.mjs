import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  isProductionMode,
  requiredVariables,
  validateConfigValue,
  validateRenderedWranglerConfig,
} from './wrangler-config-guard.mjs'

const testWranglerConfigEnv = {
  MODEL_KEYS_KV_NAMESPACE_ID: 'test-kv',
  MODEL_BUCKET_NAME: 'test-bucket',
}

function readRequiredValue(name, values, renderMode = '') {
  const value = values[name]
  if (!value) {
    throw new Error(`${name} is required to render apps/model-worker/wrangler.toml`)
  }
  return validateConfigValue(name, value, { allowTestPlaceholders: !isProductionMode(renderMode) })
}

function readOptionalInvalidKeyMode(values) {
  const mode = (values.INVALID_KEY_MODE ?? 'decoy').trim().toLowerCase() || 'decoy'
  if (mode !== 'decoy' && mode !== 'error') {
    throw new Error('INVALID_KEY_MODE must be one of: decoy, error')
  }
  return mode
}

function escapeTomlString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function replaceMainPath(content, mainPath) {
  if (!mainPath) {
    return content
  }
  return content.replace(/^\s*main\s*=\s*"[^"]*"\s*$/m, `main = "${escapeTomlString(mainPath)}"`)
}

function renderWranglerConfig(
  template,
  { values = process.env, renderMode = process.env.HV_PONY_SOLVER_RENDER_ENV || '', mainPath } = {},
) {
  const rendered = requiredVariables.reduce((content, name) => {
    return content.replaceAll('${' + name + '}', readRequiredValue(name, values, renderMode))
  }, template).replaceAll('${INVALID_KEY_MODE}', readOptionalInvalidKeyMode(values))
  return replaceMainPath(rendered, mainPath)
}

async function renderWranglerConfigFile({
  templatePath,
  outputPath,
  values = process.env,
  renderMode = process.env.HV_PONY_SOLVER_RENDER_ENV || '',
  outputName = 'apps/model-worker/wrangler.toml',
  mainPath,
}) {
  const template = await readFile(templatePath, 'utf8')
  const rendered = renderWranglerConfig(template, { values, renderMode, mainPath })
  validateRenderedWranglerConfig(rendered, outputName, { allowTestPlaceholders: !isProductionMode(renderMode) })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, rendered)
  return rendered
}

export { renderWranglerConfig, renderWranglerConfigFile, testWranglerConfigEnv }
