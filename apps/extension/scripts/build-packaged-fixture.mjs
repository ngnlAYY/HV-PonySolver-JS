import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildPackagedFixtureExtensions } from './build-extension.mjs'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(extensionRoot, 'test', 'fixtures', 'packaged-model')
const identityRecord = JSON.parse(await readFile(path.join(fixtureRoot, 'identity.json'), 'utf8'))
const model = {
  filename: identityRecord.filename,
  byteLength: identityRecord.byteLength,
  sha256: identityRecord.sha256,
}

await buildPackagedFixtureExtensions({
  model,
  modelBytes: await readFile(path.join(fixtureRoot, model.filename)),
})
