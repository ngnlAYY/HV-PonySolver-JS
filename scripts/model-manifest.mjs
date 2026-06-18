import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const defaultManifestRelativePath = 'packages/shared/src/model.ts'

function parseByteLength(value, sourcePath) {
  if (!/^[0-9]+(?:_[0-9]+)*$/.test(value)) {
    throw new Error(`Invalid MODEL_INTEGRITY.byteLength in ${sourcePath}: ${value}`)
  }
  return Number(value.replaceAll('_', ''))
}

function parseModelManifest(modelSource, options = {}) {
  const sourcePath = options.sourcePath ?? defaultManifestRelativePath
  const requireVersion = options.requireVersion ?? true
  const versionMatch = modelSource.match(/MODEL_VERSION\s*=\s*['"]([^'"]+)['"]/)
  const byteLengthMatch = modelSource.match(/MODEL_INTEGRITY\s*=\s*{[\s\S]*?['"]?byteLength['"]?\s*:\s*([0-9][0-9_]*)/)
  const sha256Match = modelSource.match(/MODEL_INTEGRITY\s*=\s*{[\s\S]*?['"]?sha256['"]?\s*:\s*['"]([a-fA-F0-9]{64})['"]/)

  if (requireVersion && !versionMatch?.[1]) {
    throw new Error(`Unable to read MODEL_VERSION from ${sourcePath}`)
  }
  if (!byteLengthMatch?.[1]) {
    throw new Error(`Unable to read MODEL_INTEGRITY.byteLength from ${sourcePath}`)
  }
  if (!sha256Match?.[1]) {
    throw new Error(`Unable to read MODEL_INTEGRITY.sha256 from ${sourcePath}`)
  }

  return {
    version: versionMatch?.[1] ?? null,
    byteLength: parseByteLength(byteLengthMatch[1], sourcePath),
    sha256: sha256Match[1].toLowerCase(),
  }
}

async function readModelManifest(repoRoot, options = {}) {
  const relativePath = options.relativePath ?? defaultManifestRelativePath
  const manifestPath = resolve(repoRoot, relativePath)
  const source = await readFile(manifestPath, 'utf8')
  return parseModelManifest(source, {
    requireVersion: options.requireVersion,
    sourcePath: manifestPath,
  })
}

export { parseModelManifest, readModelManifest }
