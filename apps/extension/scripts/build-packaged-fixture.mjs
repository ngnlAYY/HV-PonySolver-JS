import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildPackagedFixtureExtensions } from './build-extension.mjs'
import { validatePackagedOracle } from './packaged-smoke-artifact.mjs'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(extensionRoot, 'test', 'fixtures', 'packaged-model')

export function createPackagedFixtureModelIdentity(identityRecord) {
  return {
    filename: identityRecord?.filename,
    byteLength: identityRecord?.byteLength,
    sha256: identityRecord?.sha256,
    expected: validatePackagedOracle(identityRecord?.expected),
  }
}

export async function buildPackagedFixture() {
  const identityRecord = JSON.parse(await readFile(path.join(fixtureRoot, 'identity.json'), 'utf8'))
  const model = createPackagedFixtureModelIdentity(identityRecord)
  return buildPackagedFixtureExtensions({
    model,
    modelBytes: await readFile(path.join(fixtureRoot, model.filename)),
  })
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  await buildPackagedFixture()
}
