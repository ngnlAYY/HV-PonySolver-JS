import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultOutputRoot, extensionTargets, packagedModelSource, packagedModelIdentity } from './config.mjs'
import { assertSafeBuildOutputRoot, normalizeModelDelivery, parseBuildArguments } from './policy.mjs'
import { verifyPackagedModelFile, verifyPackagedModelBytes, assertRuntimeAssets } from './assets.mjs'
import { buildTarget } from './target.mjs'

export { assertSafeBuildOutputRoot, createManifest, parseBuildArguments } from './policy.mjs'
export { verifyPackagedModelFile } from './assets.mjs'
export { createTargetInventory, auditBuiltExtension } from './inventory.mjs'

function validateTargets(targets) {
  if (!Array.isArray(targets) || targets.length < 1 || targets.some((target) => !extensionTargets.has(target))) {
    throw new Error(`Unsupported extension targets: ${JSON.stringify(targets)}`)
  }
  if (new Set(targets).size !== targets.length) {
    throw new Error('Extension build targets must be unique')
  }
}

async function buildVerifiedExtensions(options) {
  const requestedOutputRoot = options.outputRoot ?? defaultOutputRoot
  const targets = options.targets ?? ['chromium', 'firefox']
  validateTargets(targets)
  const outputRoot = await assertSafeBuildOutputRoot(requestedOutputRoot)
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true })
  for (const target of targets) {
    await buildTarget(outputRoot, target, {
      fixtureHost: options.fixtureHost === true,
      fixture: options.fixture === true || options.fixtureHost === true,
      modelDelivery: options.modelDelivery,
      packagedModel: options.packagedModel,
    })
  }
  return outputRoot
}

export async function buildExtensions(options = {}) {
  const modelDelivery = normalizeModelDelivery(options.modelDelivery)
  const targets = options.targets ?? ['chromium', 'firefox']
  validateTargets(targets)
  const fixtureHost = options.fixtureHost === true
  if (modelDelivery === 'packaged' && fixtureHost) {
    throw new Error('Packaged model builds do not support the remote content Host fixture')
  }
  const packagedModel =
    modelDelivery === 'packaged' ? await verifyPackagedModelFile(packagedModelSource, packagedModelIdentity) : undefined
  await assertRuntimeAssets()
  return buildVerifiedExtensions({
    outputRoot: options.outputRoot,
    targets,
    fixtureHost,
    modelDelivery,
    packagedModel,
  })
}

export async function buildPackagedFixtureExtensions(options = {}) {
  const targets = options.targets ?? ['chromium', 'firefox']
  validateTargets(targets)
  const packagedModel = verifyPackagedModelBytes(options.modelBytes, options.model)
  await assertRuntimeAssets()
  return buildVerifiedExtensions({
    outputRoot: options.outputRoot,
    targets,
    fixture: true,
    modelDelivery: 'packaged',
    packagedModel,
  })
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  await buildExtensions(parseBuildArguments(process.argv.slice(2)))
}
