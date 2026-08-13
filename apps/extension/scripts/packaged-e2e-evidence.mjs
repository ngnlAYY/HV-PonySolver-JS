import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function writePackagedE2eEvidence(directory, target, packagedArtifact, browserVersion, driverVersion) {
  if (!directory) {
    return null
  }
  const record = {
    schemaVersion: 1,
    target,
    passed: true,
    fixture: packagedArtifact.artifact.fixture === true,
    model: packagedArtifact.artifact.model,
    archive: packagedArtifact.artifact.archive,
    browserVersion,
    ...(driverVersion ? { driverVersion } : {}),
  }
  await mkdir(directory, { recursive: true })
  const evidencePath = path.join(directory, `${target}.json`)
  await writeFile(evidencePath, `${JSON.stringify(record, null, 2)}\n`)
  return evidencePath
}
