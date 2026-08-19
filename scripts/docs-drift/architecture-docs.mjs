function checkUserscriptConfigDocs(inferenceConfigSource, readme) {
  const requiredConfigs = ['imagePreprocessConfig', 'yoloOutputConfig', 'inferenceTimeoutConfig']
  const requiredConfigNames = [
    'imageSize',
    'confidenceThreshold',
    'maxDetections',
    'maxKinds',
    'rowSize',
    'confidenceIndex',
    'classIndex',
    'workerInitTimeoutMs',
    'workerDetectTimeoutMs',
    'modelDownloadTimeoutMs',
  ]
  const errors = []
  for (const configName of requiredConfigs) {
    if (!inferenceConfigSource.includes(`export const ${configName}`)) {
      errors.push(`packages/browser-core/src/inference/inference-config.ts is missing expected config export ${configName}`)
      continue
    }
    if (!readme.includes(configName)) {
      errors.push(`README.md must mention ${configName}`)
    }
  }
  for (const configName of requiredConfigNames) {
    if (!inferenceConfigSource.includes(`${configName}:`)) {
      errors.push(`packages/browser-core/src/inference/inference-config.ts is missing expected config ${configName}`)
      continue
    }
    if (!readme.includes(configName)) {
      errors.push(`README.md must mention ${configName}`)
    }
  }
  return errors
}

function checkArchitectureGuardrails(readme) {
  const requiredTerms = [
    'architecture:check',
    'inferenceTimeoutConfig',
    'StatusPanel',
    'Model Worker Core',
  ]
  const errors = []
  for (const term of requiredTerms) {
    if (!readme.includes(term)) {
      errors.push(`README.md graph guardrails section must mention ${term}`)
    }
  }
  return errors
}

export { checkArchitectureGuardrails, checkUserscriptConfigDocs }
