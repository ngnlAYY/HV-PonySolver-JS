import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export async function discoverPackagedArtifact(outputRoot, target) {
  const targetDirectory = path.join(outputRoot, target)
  const buildManifest = JSON.parse(await readFile(path.join(targetDirectory, 'build-manifest.json'), 'utf8'))
  if (buildManifest.target !== target || buildManifest.modelDelivery !== 'packaged' || !buildManifest.model) {
    throw new Error(`${target} build manifest is not a packaged-model artifact`)
  }

  const artifactCandidates = (await readdir(outputRoot))
    .filter((name) => name.endsWith('.artifact.json'))
    .sort()
  const matchingArtifacts = []
  for (const name of artifactCandidates) {
    const artifact = JSON.parse(await readFile(path.join(outputRoot, name), 'utf8'))
    if (
      artifact.target === target
      && artifact.modelDelivery === 'packaged'
      && artifact.model?.filename === buildManifest.model.filename
      && artifact.model?.byteLength === buildManifest.model.byteLength
      && artifact.model?.sha256 === buildManifest.model.sha256
    ) {
      matchingArtifacts.push({ name, artifact })
    }
  }
  if (matchingArtifacts.length !== 1) {
    throw new Error(`Expected one ${target} packaged artifact metadata file, found ${matchingArtifacts.length}`)
  }
  const [{ name: artifactName, artifact }] = matchingArtifacts
  return {
    archivePath: path.join(outputRoot, artifact.archive.archiveName),
    artifact,
    artifactPath: path.join(outputRoot, artifactName),
    buildManifest,
    modelPath: path.join(targetDirectory, 'model', buildManifest.model.filename),
    outputRoot,
    targetDirectory,
  }
}
