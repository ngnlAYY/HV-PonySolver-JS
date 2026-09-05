import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import {
  version,
  extensionTargets,
  extensionImageResourcePattern,
  fixtureIdentityNamespace,
  fixtureDetectDelayMarker,
  runtimeWasmFilename,
  contentMatches,
  remoteModelHost,
  packagedModelIdentity,
} from './config.mjs'
import { normalizeModelDelivery, extensionContentSecurityPolicy } from './policy.mjs'
import { sha256, assertPackagedModelIdentity, verifyPackagedModelBytes } from './assets.mjs'

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

export async function createTargetInventory(targetDirectory, options = {}) {
  const readFileImpl = options.readFileImpl ?? readFile
  const files = (await walkFiles(targetDirectory)).filter(({ relativePath }) => relativePath !== 'build-manifest.json')
  return Promise.all(
    files.map(async (file) => {
      const bytes = await readFileImpl(file.absolutePath)
      return {
        ...file,
        bytes,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      }
    }),
  )
}

function requireInventoryFile(inventory, relativePath) {
  const file = inventory.find((candidate) => candidate.relativePath === relativePath)
  if (!file) {
    throw new Error(`Extension package is missing ${relativePath}`)
  }
  return file
}

async function writeBuildManifest(targetDirectory, target, metadata, inventory) {
  const fileRecords = {}
  for (const file of inventory) {
    fileRecords[file.relativePath] = { byteLength: file.byteLength, sha256: file.sha256 }
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
  'packages/browser-core/src/model/indexeddb-model-store.ts',
  'packages/browser-core/src/model/shared-model-downloads.ts',
  'packages/browser-core/src/model/model-cache-record.ts',
  'packages/browser-core/src/model/model-cache-schema.ts',
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

async function auditTargetInventory(target, options, files) {
  if (!extensionTargets.has(target)) {
    throw new Error(`Unsupported extension target: ${target}`)
  }
  const modelDelivery = normalizeModelDelivery(options.modelDelivery)
  const manifest = JSON.parse(requireInventoryFile(files, 'manifest.json').bytes.toString('utf8'))
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
    verifyPackagedModelBytes(ortFiles[0].bytes, expectedModel)
  }
  for (const file of files.filter((candidate) => candidate.relativePath.endsWith('.html'))) {
    const source = file.bytes.toString('utf8')
    auditHtmlSource(source, file.relativePath)
  }
  const javascriptSources = []
  for (const file of files.filter((candidate) => candidate.relativePath.endsWith('.js'))) {
    const source = file.bytes.toString('utf8')
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

export async function auditBuiltExtension(targetDirectory, target, options = {}) {
  return auditTargetInventory(target, options, await createTargetInventory(targetDirectory))
}

export { auditTargetInventory, writeBuildManifest }
