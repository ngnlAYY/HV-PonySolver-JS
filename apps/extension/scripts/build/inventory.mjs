import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { JSDOM } from 'jsdom'
import { EXTENSION_PATHS } from '../../src/platform/extension-paths.ts'
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
import { createManifest, normalizeModelDelivery, extensionContentSecurityPolicy } from './policy.mjs'
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

const htmlUrlAttributes = new Set(['href', 'src', 'action', 'formaction', 'data'])

function auditHtmlSource(source, relativePath, relativeFiles) {
  const dom = new JSDOM(source)
  const baseUrl = `https://extension.invalid/${relativePath}`
  try {
    const roots = [dom.window.document]
    for (const root of roots) {
      for (const element of root.querySelectorAll('*')) {
        // template 内容不在 document 查询结果中；后续插入时仍须满足同一执行边界。
        if (element instanceof dom.window.HTMLTemplateElement) roots.push(element.content)
        if (element.localName === 'base') {
          throw new Error(`${relativePath} contains a base URL override`)
        }
        for (const attribute of element.attributes) {
          const name = attribute.localName.toLowerCase()
          if (name.startsWith('on')) {
            throw new Error(`${relativePath} contains an inline event handler: ${attribute.name}`)
          }
          if (name === 'srcdoc') {
            throw new Error(`${relativePath} contains inline frame srcdoc content`)
          }
          // URL 解析会处理实体解码后的制表符、换行与 scheme 大小写，不能只检查原始前缀。
          if (htmlUrlAttributes.has(name) && new globalThis.URL(attribute.value, baseUrl).protocol === 'javascript:') {
            throw new Error(`${relativePath} contains an executable URL: ${attribute.name}`)
          }
          const scriptReference = element.localName === 'script' && (name === 'src' || name === 'href')
          const styleReference = element.localName === 'link' && name === 'href'
          if (!scriptReference && !styleReference) continue
          const reference = attribute.value
          const resource = new globalThis.URL(reference, baseUrl)
          if (resource.origin !== 'https://extension.invalid' || !relativeFiles.has(resource.pathname.slice(1))) {
            if (/^https?:/iu.test(reference)) {
              throw new Error(`${relativePath} references remote executable content`)
            }
            throw new Error(`${relativePath} references a missing or non-local resource: ${reference}`)
          }
        }
        if (element.localName === 'script' && element.textContent?.trim()) {
          throw new Error(`${relativePath} contains inline script content`)
        }
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
  if (manifest?.manifest_version !== 3) {
    throw new Error(`${target} package must use Manifest V3`)
  }
  if (manifest.version !== version) {
    throw new Error(`${target} package version does not match the extension package`)
  }
  for (const field of ['optional_permissions', 'optional_host_permissions', 'externally_connectable', 'sandbox']) {
    if (field in manifest) {
      throw new Error(`${target} package unexpectedly declares ${field}`)
    }
  }
  const expectedManifest = createManifest(target, { modelDelivery })
  if (!isDeepStrictEqual(manifest.background, expectedManifest.background)) {
    throw new Error(`${target} background declaration is invalid`)
  }
  if (!isDeepStrictEqual(manifest.options_ui, expectedManifest.options_ui)) {
    throw new Error(`${target} options page declaration is invalid`)
  }
  if (!isDeepStrictEqual(manifest.content_scripts, expectedManifest.content_scripts)) {
    throw new Error(`${target} content script declaration is invalid`)
  }
  if (!isDeepStrictEqual(manifest.action, expectedManifest.action)) {
    throw new Error(`${target} action declaration is invalid`)
  }
  const expectedCsp = extensionContentSecurityPolicy(modelDelivery)
  if (!isDeepStrictEqual(manifest.content_security_policy, { extension_pages: expectedCsp })) {
    throw new Error(`${target} extension CSP does not match the ${modelDelivery} security policy`)
  }
  const expectedPermissions = target === 'chromium' ? ['offscreen', 'storage'] : ['storage']
  if (
    !Array.isArray(manifest.permissions) ||
    !isDeepStrictEqual([...manifest.permissions].sort(), expectedPermissions)
  ) {
    throw new Error(`${target} package requests unexpected API permissions`)
  }
  const expectedHosts = [...contentMatches, ...(modelDelivery === 'remote' ? [remoteModelHost] : [])].sort()
  if (
    !Array.isArray(manifest.host_permissions) ||
    !isDeepStrictEqual([...manifest.host_permissions].sort(), expectedHosts)
  ) {
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
  if (files.some((file) => !file.relativePath.includes('/') && file.relativePath !== 'manifest.json')) {
    throw new Error(`${target} package root must contain only manifest files`)
  }
  for (const required of [
    EXTENSION_PATHS.backgroundScript,
    EXTENSION_PATHS.contentScript,
    EXTENSION_PATHS.inferenceWorker,
    EXTENSION_PATHS.optionsPage,
    EXTENSION_PATHS.optionsScript,
    EXTENSION_PATHS.optionsStyles,
    `runtime/${runtimeWasmFilename}`,
  ]) {
    if (!relativeFiles.has(required)) {
      throw new Error(`${target} package is missing ${required}`)
    }
  }
  if (
    target === 'chromium' &&
    (!relativeFiles.has(EXTENSION_PATHS.offscreenPage) || !relativeFiles.has(EXTENSION_PATHS.offscreenScript))
  ) {
    throw new Error('Chromium package is missing its offscreen host')
  }
  if (
    target === 'firefox' &&
    (relativeFiles.has(EXTENSION_PATHS.offscreenPage) || relativeFiles.has(EXTENSION_PATHS.offscreenScript))
  ) {
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
    auditHtmlSource(source, file.relativePath, relativeFiles)
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
