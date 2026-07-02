import { parseModelManifest } from '../model-manifest.mjs'

function checkModelManifestDocs(modelSource, readme) {
  const expectedModel = parseModelManifest(modelSource)
  const errors = []

  if (!readme.includes(expectedModel.version)) {
    errors.push(`README.md must mention MODEL_VERSION value ${expectedModel.version}`)
  }

  const manifestTerms = ['MODEL_VERSION', 'MODEL_INTEGRITY.byteLength', 'MODEL_INTEGRITY.sha256']
  for (const term of manifestTerms) {
    if (!readme.includes(term)) {
      errors.push(`README.md must mention ${term} from packages/shared/src/model.ts`)
    }
  }

  for (const term of ['verify-model-integrity', 'MODEL_FILE']) {
    if (!readme.includes(term)) {
      errors.push(`README.md model manifest check must mention ${term}`)
    }
  }

  return errors
}

export { checkModelManifestDocs }
