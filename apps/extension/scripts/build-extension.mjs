import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'
import { zipSync } from 'fflate'
import { JSDOM } from 'jsdom'

import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'

import { browserSupport } from './browser-support.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDirectory, '..')
const repositoryRoot = path.resolve(extensionRoot, '../..')
const packageJson = JSON.parse(await readFile(path.join(extensionRoot, 'package.json'), 'utf8'))
const version = packageJson.version
const runtimeWasmFilename = 'ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm'
const runtimeWasmSha256 = '25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa'
const runtimeWasmSource = path.join(repositoryRoot, 'other', runtimeWasmFilename)
const runtimeGlueSource = path.join(
  repositoryRoot,
  'apps',
  'userscript',
  'vendor',
  'onnxruntime',
  'ort.wasm.bundle.min.mjs',
)
const runtimeGlueSha256 = 'a63d4f08e70220c0f721fabfd4e4b958aa127334a19038b2732d07e919f32554'
const deterministicZipTimestamp = new Date('1980-01-01T00:00:00.000Z')
const dynamicRuntimeImport = 'import(/*webpackIgnore:true*/ /*@vite-ignore*/t)'
const disabledDynamicRuntimeImport =
  'Promise.reject(new Error("Dynamic ONNX runtime modules are disabled in the extension build"))'
const modelDeliveryModes = new Set(['remote', 'packaged'])
const extensionTargets = new Set(['chromium', 'firefox'])
const extensionImageResourcePattern = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/iu
const remoteModelOrigin = 'https://models.ngnl.host'
const remoteModelHost = `${remoteModelOrigin}/*`
const defaultOutputRoot = path.join(extensionRoot, 'dist')
const packagedModelIdentity = Object.freeze({
  filename: ORT_MODEL_FILENAME,
  byteLength: ORT_MODEL_INTEGRITY.byteLength,
  sha256: ORT_MODEL_INTEGRITY.sha256,
})
const packagedModelSource = path.join(repositoryRoot, 'model', ORT_MODEL_FILENAME)
const packagedModelIdentityModule = path.join(extensionRoot, 'src', 'host', 'packaged-model-identity.ts')
const fixtureIdentityNamespace = 'fixture-packaged-model-identity'
const fixtureDetectHookModule = path.join(extensionRoot, 'src', 'host', 'fixture-detect-hook.ts')
const fixtureDetectHookNamespace = 'fixture-detect-hook'
const fixtureDetectDelayMarker = 'hv-pony-fixture-detect-delay'

const contentMatches = ['https://hentaiverse.org/*', 'https://alt.hentaiverse.org/*']
const contentExcludes = [
  'https://hentaiverse.org/battle_stats*',
  'https://alt.hentaiverse.org/battle_stats*',
  'https://hentaiverse.org/equip/*',
  'https://hentaiverse.org/isekai/equip/*',
]

function isPathWithin(candidate, root) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function canonicalizePotentialPath(candidate) {
  const resolved = path.resolve(candidate)
  const missingSegments = []
  let current = resolved
  while (true) {
    try {
      const canonicalParent = await realpath(current)
      return path.join(canonicalParent, ...missingSegments.reverse())
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error(`Unable to canonicalize extension output path: ${resolved}`, { cause: error })
      }
      const parent = path.dirname(current)
      if (parent === current) {
        throw new Error(`Unable to canonicalize extension output path: ${resolved}`, { cause: error })
      }
      missingSegments.push(path.basename(current))
      current = parent
    }
  }
}

export async function assertSafeBuildOutputRoot(requestedOutputRoot) {
  if (typeof requestedOutputRoot !== 'string' || requestedOutputRoot.trim() === '') {
    throw new TypeError('Extension output root must be a non-empty path')
  }
  const resolvedOutputRoot = path.resolve(requestedOutputRoot)
  try {
    const stats = await lstat(resolvedOutputRoot)
    if (stats.isSymbolicLink()) {
      throw new Error(`Extension output root must not be a symbolic link: ${resolvedOutputRoot}`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }

  const rootCandidates = [extensionRoot, os.tmpdir(), process.cwd(), os.homedir(), repositoryRoot]
  if (process.env.RUNNER_TEMP) {
    rootCandidates.push(process.env.RUNNER_TEMP)
  }
  const [
    canonicalOutputRoot,
    canonicalExtensionRoot,
    canonicalTemporaryRoot,
    canonicalCwd,
    canonicalHome,
    canonicalRepository,
    canonicalRunnerRoot,
  ] = await Promise.all([
    canonicalizePotentialPath(resolvedOutputRoot),
    ...rootCandidates.map((candidate) => canonicalizePotentialPath(candidate)),
  ])
  const filesystemRoot = path.parse(canonicalOutputRoot).root
  if ([filesystemRoot, canonicalCwd, canonicalHome, canonicalRepository].includes(canonicalOutputRoot)) {
    throw new Error(`Refusing to recursively remove protected path: ${canonicalOutputRoot}`)
  }

  const canonicalDefaultRoot = path.join(canonicalExtensionRoot, 'dist')
  const isDefaultBuildOutput = isPathWithin(canonicalOutputRoot, canonicalDefaultRoot)
  if (isPathWithin(canonicalOutputRoot, canonicalRepository) && !isDefaultBuildOutput) {
    throw new Error(`Refusing to recursively remove source tree path: ${canonicalOutputRoot}`)
  }

  const isUsableTemporaryRoot = (candidate) =>
    candidate !== path.parse(candidate).root &&
    ![canonicalCwd, canonicalHome, canonicalRepository].includes(candidate) &&
    !isPathWithin(candidate, canonicalRepository)
  const isTemporaryOutput =
    isUsableTemporaryRoot(canonicalTemporaryRoot) &&
    canonicalOutputRoot !== canonicalTemporaryRoot &&
    isPathWithin(canonicalOutputRoot, canonicalTemporaryRoot)
  const isRunnerTemporaryOutput =
    canonicalRunnerRoot !== undefined &&
    isUsableTemporaryRoot(canonicalRunnerRoot) &&
    canonicalOutputRoot !== canonicalRunnerRoot &&
    isPathWithin(canonicalOutputRoot, canonicalRunnerRoot)
  if (!isDefaultBuildOutput && !isTemporaryOutput && !isRunnerTemporaryOutput) {
    throw new Error(`Extension output root is outside allowed build roots: ${canonicalOutputRoot}`)
  }
  return canonicalOutputRoot
}

function extensionContentSecurityPolicy(modelDelivery) {
  const connectSources = modelDelivery === 'remote' ? `'self' ${remoteModelOrigin}` : "'self'"
  return `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src ${connectSources}`
}

function normalizeModelDelivery(value = 'remote') {
  if (!modelDeliveryModes.has(value)) {
    throw new Error(`Unsupported extension model delivery mode: ${value}`)
  }
  return value
}

export function parseBuildArguments(args) {
  let modelDelivery = 'remote'
  let modelModeSeen = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    let value
    if (argument === '--model-mode') {
      value = args[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--model-mode requires remote or packaged')
      }
      index += 1
    } else if (argument.startsWith('--model-mode=')) {
      value = argument.slice('--model-mode='.length)
      if (!value) {
        throw new Error('--model-mode requires remote or packaged')
      }
    } else {
      throw new Error(`Unknown extension build argument: ${argument}`)
    }
    if (modelModeSeen) {
      throw new Error('--model-mode may be provided only once')
    }
    modelDelivery = normalizeModelDelivery(value)
    modelModeSeen = true
  }
  return { modelDelivery }
}

function commonManifest(modelDelivery = 'remote') {
  modelDelivery = normalizeModelDelivery(modelDelivery)
  return {
    manifest_version: 3,
    name: 'HV Pony Solver',
    version,
    description: 'Locally recognizes HentaiVerse pony captchas with a packaged ONNX runtime.',
    permissions: ['storage'],
    host_permissions: [...contentMatches, ...(modelDelivery === 'remote' ? [remoteModelHost] : [])],
    content_scripts: [
      {
        matches: contentMatches,
        exclude_matches: contentExcludes,
        js: ['content.js'],
        run_at: 'document_idle',
      },
    ],
    action: {
      default_title: 'HV Pony Solver 设置',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    content_security_policy: {
      extension_pages: extensionContentSecurityPolicy(modelDelivery),
    },
  }
}

export function createManifest(target, options = {}) {
  const modelDelivery = normalizeModelDelivery(options.modelDelivery)
  const common = commonManifest(modelDelivery)
  if (target === 'chromium') {
    return {
      ...common,
      minimum_chrome_version: browserSupport.chromium.manifestMinimumVersion,
      permissions: [...common.permissions, 'offscreen'],
      background: {
        service_worker: 'background.js',
      },
    }
  }
  if (target === 'firefox') {
    return {
      ...common,
      background: {
        scripts: ['background.js'],
      },
      browser_specific_settings: {
        gecko: {
          id: 'hv-pony-solver@ngnl.host',
          strict_min_version: browserSupport.firefox.manifestMinimumVersion,
          data_collection_permissions: {
            required: [modelDelivery === 'remote' ? 'authenticationInfo' : 'none'],
          },
        },
        gecko_android: {
          strict_min_version: browserSupport.firefox.androidManifestMinimumVersion,
        },
      },
    }
  }
  throw new Error(`Unsupported extension target: ${target}`)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function assertPackagedModelIdentity(identity) {
  if (!identity || !/^[A-Za-z0-9._-]+\.ort$/u.test(identity.filename ?? '')) {
    throw new Error('Packaged model identity has an invalid filename')
  }
  if (!Number.isSafeInteger(identity.byteLength) || identity.byteLength <= 0) {
    throw new Error('Packaged model identity has an invalid byte length')
  }
  if (!/^[a-f0-9]{64}$/u.test(identity.sha256 ?? '')) {
    throw new Error('Packaged model identity has an invalid SHA-256')
  }
}

function verifyPackagedModelBytes(bytes, identity) {
  assertPackagedModelIdentity(identity)
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Packaged model bytes must be a Uint8Array')
  }
  if (bytes.byteLength !== identity.byteLength) {
    throw new Error(
      `Packaged model byte length mismatch: expected ${identity.byteLength}, received ${bytes.byteLength}`,
    )
  }
  const actualSha256 = sha256(bytes)
  if (actualSha256 !== identity.sha256) {
    throw new Error(`Packaged model SHA-256 mismatch: expected ${identity.sha256}, received ${actualSha256}`)
  }
  return { bytes, identity: { ...identity } }
}

export async function verifyPackagedModelFile(sourcePath, identity = packagedModelIdentity) {
  let stats
  try {
    stats = await lstat(sourcePath)
  } catch (error) {
    throw new Error(`Unable to inspect packaged model source: ${sourcePath}`, { cause: error })
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Packaged model source must not be a symbolic link: ${sourcePath}`)
  }
  if (!stats.isFile()) {
    throw new Error(`Packaged model source must be a regular file: ${sourcePath}`)
  }
  const bytes = await readFile(sourcePath)
  return verifyPackagedModelBytes(bytes, identity)
}

function extensionRuntimeGluePlugin() {
  return {
    name: 'extension-runtime-glue',
    setup(buildApi) {
      buildApi.onLoad({ filter: /ort\.wasm\.bundle\.min\.mjs$/ }, async (args) => {
        const source = await readFile(args.path, 'utf8')
        const firstMatch = source.indexOf(dynamicRuntimeImport)
        if (firstMatch < 0 || source.indexOf(dynamicRuntimeImport, firstMatch + 1) >= 0) {
          throw new Error('Expected exactly one dynamic import in the tracked ONNX Runtime glue')
        }
        return {
          contents: source.replace(dynamicRuntimeImport, disabledDynamicRuntimeImport),
          loader: 'js',
        }
      })
    },
  }
}

function packagedModelIdentityPlugin(identity) {
  assertPackagedModelIdentity(identity)
  return {
    name: fixtureIdentityNamespace,
    setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\/packaged-model-identity$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, `${args.path}.ts`)
        if (resolved !== packagedModelIdentityModule) {
          return undefined
        }
        return { path: 'identity', namespace: fixtureIdentityNamespace }
      })
      buildApi.onLoad({ filter: /.*/, namespace: fixtureIdentityNamespace }, () => ({
        contents: [
          `export const PACKAGED_MODEL_FILENAME = ${JSON.stringify(identity.filename)};`,
          `export const PACKAGED_MODEL_INTEGRITY = Object.freeze(${JSON.stringify({
            byteLength: identity.byteLength,
            sha256: identity.sha256,
          })});`,
        ].join('\n'),
        loader: 'js',
      }))
    },
  }
}

function fixtureDetectHookPlugin() {
  return {
    name: fixtureDetectHookNamespace,
    setup(buildApi) {
      buildApi.onResolve({ filter: /^\.\/fixture-detect-hook$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, `${args.path}.ts`)
        if (resolved !== fixtureDetectHookModule) {
          return undefined
        }
        return { path: 'fixture-detect-hook', namespace: fixtureDetectHookNamespace }
      })
      buildApi.onLoad({ filter: /.*/, namespace: fixtureDetectHookNamespace }, () => ({
        contents: `export const fixtureBeforeDetect = () => new Promise((resolve) => setTimeout(resolve, 5000, ${JSON.stringify(
          fixtureDetectDelayMarker,
        )}));`,
        loader: 'js',
      }))
    },
  }
}

async function assertRuntimeAssets() {
  const [wasmBytes, glueBytes] = await Promise.all([readFile(runtimeWasmSource), readFile(runtimeGlueSource)])
  if (sha256(wasmBytes) !== runtimeWasmSha256) {
    throw new Error('Tracked ONNX Runtime WASM failed its SHA-256 check')
  }
  if (sha256(glueBytes) !== runtimeGlueSha256) {
    throw new Error('Tracked ONNX Runtime JavaScript glue failed its SHA-256 check')
  }
}

async function walkFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, absolutePath)))
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath: path.relative(root, absolutePath).split(path.sep).join('/') })
    }
  }
  return files
}

async function writeBuildManifest(targetDirectory, target, metadata) {
  const files = await walkFiles(targetDirectory)
  const fileRecords = {}
  for (const file of files) {
    const bytes = await readFile(file.absolutePath)
    fileRecords[file.relativePath] = { byteLength: bytes.byteLength, sha256: sha256(bytes) }
  }
  await writeFile(
    path.join(targetDirectory, 'build-manifest.json'),
    `${JSON.stringify({ target, version, ...metadata, files: fileRecords }, null, 2)}\n`,
  )
  return fileRecords
}

const packagedForbiddenInputSuffixes = [
  'apps/extension/src/host/remote-inference-host.ts',
  'apps/extension/src/host/indexeddb-string-storage.ts',
  'apps/extension/src/options/main.ts',
  'apps/extension/src/options/remote.ts',
  'packages/browser-core/src/model/model-cache.ts',
  'packages/browser-core/src/model/model-config.ts',
  'packages/browser-core/src/model/model-download-error.ts',
  'packages/browser-core/src/model/model-downloader.ts',
  'packages/browser-core/src/model/model-settings.ts',
  'packages/shared/src/ort-assets.ts',
]

function auditPackagedMetafiles(metafiles, target, fixture = false) {
  const contributingInputs = new Set()
  for (const metafile of metafiles) {
    for (const output of Object.values(metafile.outputs ?? {})) {
      for (const [input, contribution] of Object.entries(output.inputs ?? {})) {
        if (contribution.bytesInOutput > 0) {
          contributingInputs.add(input.split(path.sep).join('/'))
        }
      }
    }
  }
  if (contributingInputs.size === 0) {
    throw new Error(`${target} packaged-model build produced no auditable esbuild inputs`)
  }
  for (const forbidden of packagedForbiddenInputSuffixes) {
    const matched = [...contributingInputs].find((input) => input.endsWith(forbidden))
    if (matched) {
      throw new Error(`${target} packaged-model build includes remote-only input: ${forbidden}`)
    }
  }
  const hasFixtureIdentity = [...contributingInputs].some((input) => input.includes(fixtureIdentityNamespace))
  if (fixture !== hasFixtureIdentity) {
    throw new Error(
      fixture
        ? `${target} fixture build did not use the fixture packaged-model identity`
        : `${target} production build includes the fixture packaged-model identity`,
    )
  }
}

function auditHtmlSource(source, relativePath) {
  const dom = new JSDOM(source)
  try {
    for (const element of dom.window.document.querySelectorAll('script[src], link[href]')) {
      const attribute = element.localName === 'script' ? 'src' : 'href'
      if (/^https?:/iu.test(element.getAttribute(attribute) ?? '')) {
        throw new Error(`${relativePath} references remote executable content`)
      }
    }
    for (const script of dom.window.document.scripts) {
      if (script.textContent?.trim()) {
        throw new Error(`${relativePath} contains inline script content`)
      }
    }
  } finally {
    dom.window.close()
  }
}

export async function auditBuiltExtension(targetDirectory, target, options = {}) {
  if (!extensionTargets.has(target)) {
    throw new Error(`Unsupported extension target: ${target}`)
  }
  const modelDelivery = normalizeModelDelivery(options.modelDelivery)
  const manifest = JSON.parse(await readFile(path.join(targetDirectory, 'manifest.json'), 'utf8'))
  const expectedBackground =
    target === 'chromium' ? manifest.background?.service_worker : manifest.background?.scripts?.[0]
  if (expectedBackground !== 'background.js') {
    throw new Error(`${target} background declaration is invalid`)
  }
  const expectedCsp = extensionContentSecurityPolicy(modelDelivery)
  if (manifest.content_security_policy?.extension_pages !== expectedCsp) {
    throw new Error(`${target} extension CSP does not match the ${modelDelivery} security policy`)
  }
  const expectedPermissions = target === 'chromium' ? ['offscreen', 'storage'] : ['storage']
  if ([...manifest.permissions].sort().join(',') !== expectedPermissions.join(',')) {
    throw new Error(`${target} package requests unexpected API permissions`)
  }
  const expectedHosts = [...contentMatches, ...(modelDelivery === 'remote' ? [remoteModelHost] : [])].sort()
  if ([...manifest.host_permissions].sort().join(',') !== expectedHosts.join(',')) {
    throw new Error(`${target} package requests unexpected host permissions`)
  }
  if (target === 'firefox') {
    const expectedDataCollection = [modelDelivery === 'remote' ? 'authenticationInfo' : 'none']
    const actualDataCollection = manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required
    if (JSON.stringify(actualDataCollection) !== JSON.stringify(expectedDataCollection)) {
      throw new Error('Firefox package declares unexpected data collection permissions')
    }
  }
  if ('web_accessible_resources' in manifest) {
    throw new Error(`${target} package unexpectedly exposes a web-accessible resource`)
  }
  const files = await walkFiles(targetDirectory)
  if (
    'icons' in manifest ||
    manifest.action?.default_icon !== undefined ||
    manifest.browser_action?.default_icon !== undefined ||
    files.some((file) => extensionImageResourcePattern.test(file.relativePath))
  ) {
    throw new Error(`${target} package must not contain image resources`)
  }
  const relativeFiles = new Set(files.map((file) => file.relativePath))
  for (const required of [
    'background.js',
    'content.js',
    'inference-worker.js',
    'options.html',
    'options.js',
    `runtime/${runtimeWasmFilename}`,
  ]) {
    if (!relativeFiles.has(required)) {
      throw new Error(`${target} package is missing ${required}`)
    }
  }
  if (target === 'chromium' && (!relativeFiles.has('offscreen.html') || !relativeFiles.has('offscreen.js'))) {
    throw new Error('Chromium package is missing its offscreen host')
  }
  if (target === 'firefox' && (relativeFiles.has('offscreen.html') || relativeFiles.has('offscreen.js'))) {
    throw new Error('Firefox package unexpectedly includes Chromium offscreen files')
  }
  const ortFiles = files.filter((candidate) => candidate.relativePath.endsWith('.ort'))
  if (modelDelivery === 'remote') {
    if (ortFiles.length !== 0) {
      throw new Error(`${target} remote-model package unexpectedly contains an ORT model`)
    }
  } else {
    const expectedModel = options.model ?? packagedModelIdentity
    assertPackagedModelIdentity(expectedModel)
    const expectedModelPath = `model/${expectedModel.filename}`
    if (ortFiles.length !== 1 || ortFiles[0]?.relativePath !== expectedModelPath) {
      throw new Error(`${target} packaged-model package must contain only ${expectedModelPath}`)
    }
    verifyPackagedModelBytes(await readFile(ortFiles[0].absolutePath), expectedModel)
  }
  for (const file of files.filter((candidate) => candidate.relativePath.endsWith('.html'))) {
    const source = await readFile(file.absolutePath, 'utf8')
    auditHtmlSource(source, file.relativePath)
  }
  const javascriptSources = []
  for (const file of files.filter((candidate) => candidate.relativePath.endsWith('.js'))) {
    const source = await readFile(file.absolutePath, 'utf8')
    javascriptSources.push([file.relativePath, source])
    if (/\bimport\s*\(/u.test(source)) {
      throw new Error(`${file.relativePath} contains a dynamic import`)
    }
    if (/https?:\/\/[^"'\s]+\.(?:m?js|wasm)(?:[?"'\s]|$)/iu.test(source)) {
      throw new Error(`${file.relativePath} references remote executable code`)
    }
  }
  if (options.fixture !== true) {
    for (const [relativePath, source] of javascriptSources) {
      if (source.includes(fixtureDetectDelayMarker)) {
        throw new Error(
          `${target} ${relativePath} contains the fixture detect-delay marker: ${fixtureDetectDelayMarker}`,
        )
      }
    }
  }
  if (modelDelivery === 'packaged') {
    const remoteCapability =
      /https:\/\/models\.ngnl\.host|hvPonySolverExtensionSecrets|hvPonySolverModelAccessKey|Bearer /u
    for (const [relativePath, source] of javascriptSources) {
      const matched = source.match(remoteCapability)?.[0]
      if (matched) {
        throw new Error(`${target} ${relativePath} contains a remote-model capability: ${matched}`)
      }
    }
    if (options.metafiles !== undefined) {
      auditPackagedMetafiles(options.metafiles, target, options.fixture === true)
    }
  }
}

function createBuildMetadata(modelDelivery, packagedModel, fixture) {
  return {
    modelDelivery,
    ...(modelDelivery === 'packaged' ? { model: { ...packagedModel.identity } } : {}),
    ...(fixture ? { fixture: true } : {}),
  }
}

function artifactBaseName(target, modelDelivery, fixture = false) {
  const modeSuffix = modelDelivery === 'packaged' ? '-packaged' : ''
  const fixtureSuffix = fixture ? '-fixture' : ''
  return `hv-pony-solver-${target}${modeSuffix}${fixtureSuffix}-${version}`
}

async function createArchive(targetDirectory, outputRoot, target, modelDelivery, fixture) {
  const files = await walkFiles(targetDirectory)
  const entries = {}
  for (const file of files) {
    entries[file.relativePath] = [
      new Uint8Array(await readFile(file.absolutePath)),
      { mtime: deterministicZipTimestamp },
    ]
  }
  const archiveName = `${artifactBaseName(target, modelDelivery, fixture)}.zip`
  const archiveBytes = zipSync(entries, { level: 9 })
  const archivePath = path.join(outputRoot, archiveName)
  await writeFile(archivePath, archiveBytes)
  const archiveHash = sha256(archiveBytes)
  await writeFile(`${archivePath}.sha256`, `${archiveHash}  ${archiveName}\n`)
  return { archiveName, byteLength: archiveBytes.byteLength, sha256: archiveHash }
}

async function buildTarget(outputRoot, target, options = {}) {
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
  await auditBuiltExtension(targetDirectory, target, {
    modelDelivery,
    model: packagedModel?.identity,
    metafiles: [extensionBuild.metafile, workerBuild.metafile],
    fixture: options.fixture === true,
  })
  const metadata = createBuildMetadata(modelDelivery, packagedModel, options.fixture === true)
  const files = await writeBuildManifest(targetDirectory, target, metadata)
  const fixture = options.fixture === true
  const archive = await createArchive(targetDirectory, outputRoot, target, modelDelivery, fixture)
  await writeFile(
    path.join(outputRoot, `${artifactBaseName(target, modelDelivery, fixture)}.artifact.json`),
    `${JSON.stringify({ target, version, ...metadata, archive, files }, null, 2)}\n`,
  )
}

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
