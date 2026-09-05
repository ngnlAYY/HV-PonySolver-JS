import { cp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { browserSupport } from '../browser-support.mjs'
import { extensionRoot, version, runtimeGlueSource, runtimeWasmSource, runtimeWasmFilename } from './config.mjs'
import { createManifest, normalizeModelDelivery } from './policy.mjs'
import { extensionRuntimeGluePlugin, packagedModelIdentityPlugin, fixtureDetectHookPlugin } from './assets.mjs'
import { createTargetInventory, auditTargetInventory, writeBuildManifest } from './inventory.mjs'
import { artifactBaseName, createArchive } from './archive.mjs'

function createBuildMetadata(modelDelivery, packagedModel, fixture) {
  return {
    modelDelivery,
    ...(modelDelivery === 'packaged' ? { model: { ...packagedModel.identity } } : {}),
    ...(fixture ? { fixture: true } : {}),
  }
}

export async function buildTarget(outputRoot, target, options = {}) {
  const fixtureHost = options.fixtureHost === true
  const modelDelivery = normalizeModelDelivery(options.modelDelivery)
  const packagedModel = options.packagedModel
  if (modelDelivery === 'packaged' && !packagedModel) {
    throw new Error('Packaged model bytes were not provided to the target build')
  }
  const targetDirectory = path.join(outputRoot, target)
  await mkdir(targetDirectory, { recursive: true })
  const entryPoints = {
    background: path.join(
      extensionRoot,
      'src',
      'background',
      modelDelivery === 'packaged'
        ? target === 'chromium'
          ? 'chromium-packaged.ts'
          : 'firefox-packaged.ts'
        : fixtureHost && target === 'chromium'
          ? 'chromium-fixture.ts'
          : target === 'chromium'
            ? 'chromium.ts'
            : 'firefox.ts',
    ),
    content: path.join(extensionRoot, 'src', 'content', 'main.ts'),
    options: path.join(extensionRoot, 'src', 'options', modelDelivery === 'packaged' ? 'packaged.ts' : 'main.ts'),
  }
  if (target === 'chromium') {
    entryPoints.offscreen = path.join(
      extensionRoot,
      'src',
      'offscreen',
      modelDelivery === 'packaged' ? 'packaged.ts' : 'main.ts',
    )
  }
  const extensionBuild = await build({
    entryPoints,
    outdir: targetDirectory,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: [browserSupport[target].esbuildTarget],
    minify: true,
    charset: 'utf8',
    legalComments: 'none',
    sourcemap: false,
    logLevel: 'warning',
    metafile: true,
    plugins:
      options.fixture === true && modelDelivery === 'packaged'
        ? [packagedModelIdentityPlugin(packagedModel.identity)]
        : [],
  })
  const workerBuild = await build({
    entryPoints: [path.join(extensionRoot, 'src', 'host', 'inference-worker-entry.ts')],
    outfile: path.join(targetDirectory, 'inference-worker.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: [browserSupport[target].esbuildTarget],
    minify: true,
    legalComments: 'none',
    sourcemap: false,
    logLevel: 'warning',
    metafile: true,
    alias: {
      'onnxruntime-web/wasm': runtimeGlueSource,
    },
    plugins: [
      extensionRuntimeGluePlugin(),
      ...(options.fixture === true && modelDelivery === 'packaged' && target === 'chromium'
        ? [fixtureDetectHookPlugin()]
        : []),
    ],
  })
  await cp(path.join(extensionRoot, 'public', 'options.html'), path.join(targetDirectory, 'options.html'))
  await cp(path.join(extensionRoot, 'public', 'options.css'), path.join(targetDirectory, 'options.css'))
  if (target === 'chromium') {
    await cp(path.join(extensionRoot, 'public', 'offscreen.html'), path.join(targetDirectory, 'offscreen.html'))
  }
  await mkdir(path.join(targetDirectory, 'runtime'), { recursive: true })
  await cp(runtimeWasmSource, path.join(targetDirectory, 'runtime', runtimeWasmFilename))
  if (modelDelivery === 'packaged') {
    const modelDirectory = path.join(targetDirectory, 'model')
    await mkdir(modelDirectory, { recursive: true })
    await writeFile(path.join(modelDirectory, packagedModel.identity.filename), packagedModel.bytes)
  }
  await writeFile(
    path.join(targetDirectory, 'manifest.json'),
    `${JSON.stringify(createManifest(target, { modelDelivery }), null, 2)}\n`,
  )
  const inventory = await createTargetInventory(targetDirectory)
  await auditTargetInventory(
    target,
    {
      modelDelivery,
      model: packagedModel?.identity,
      metafiles: [extensionBuild.metafile, workerBuild.metafile],
      fixture: options.fixture === true,
    },
    inventory,
  )
  const metadata = createBuildMetadata(modelDelivery, packagedModel, options.fixture === true)
  const files = await writeBuildManifest(targetDirectory, target, metadata, inventory)
  const fixture = options.fixture === true
  const archive = await createArchive(targetDirectory, outputRoot, target, modelDelivery, fixture, inventory)
  await writeFile(
    path.join(outputRoot, `${artifactBaseName(target, modelDelivery, fixture)}.artifact.json`),
    `${JSON.stringify({ target, version, ...metadata, archive, files }, null, 2)}\n`,
  )
}
