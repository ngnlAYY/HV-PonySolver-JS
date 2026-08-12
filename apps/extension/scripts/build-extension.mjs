import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'
import { zipSync } from 'fflate'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDirectory, '..')
const repositoryRoot = path.resolve(extensionRoot, '../..')
const packageJson = JSON.parse(await readFile(path.join(extensionRoot, 'package.json'), 'utf8'))
const version = packageJson.version
const runtimeWasmFilename = 'ort-wasm-simd-25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa.wasm'
const runtimeWasmSha256 = '25d707460dd5286203299356b17f4262ace93b712e4708b893d4cfd902da2aaa'
const runtimeWasmSource = path.join(repositoryRoot, 'other', runtimeWasmFilename)
const runtimeGlueSource = path.join(repositoryRoot, 'apps', 'userscript', 'vendor', 'onnxruntime', 'ort.wasm.bundle.min.mjs')
const runtimeGlueSha256 = 'a63d4f08e70220c0f721fabfd4e4b958aa127334a19038b2732d07e919f32554'
const deterministicZipTimestamp = new Date('1980-01-01T00:00:00.000Z')
const dynamicRuntimeImport = 'import(/*webpackIgnore:true*/ /*@vite-ignore*/t)'
const disabledDynamicRuntimeImport = 'Promise.reject(new Error("Dynamic ONNX runtime modules are disabled in the extension build"))'

const contentMatches = ['https://hentaiverse.org/*', 'https://alt.hentaiverse.org/*']
const contentExcludes = [
  'https://hentaiverse.org/battle_stats*',
  'https://alt.hentaiverse.org/battle_stats*',
  'https://hentaiverse.org/equip/*',
  'https://hentaiverse.org/isekai/equip/*',
]

function commonManifest() {
  return {
    manifest_version: 3,
    name: 'HV Pony Solver',
    version,
    description: 'Locally recognizes HentaiVerse pony captchas with a packaged ONNX runtime.',
    permissions: ['storage'],
    host_permissions: [...contentMatches, 'https://models.ngnl.host/*'],
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
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  }
}

export function createManifest(target) {
  const common = commonManifest()
  if (target === 'chromium') {
    return {
      ...common,
      minimum_chrome_version: '116',
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
        persistent: false,
      },
      browser_specific_settings: {
        gecko: {
          id: 'hv-pony-solver@ngnl.host',
          strict_min_version: '142.0',
          data_collection_permissions: {
            required: ['authenticationInfo'],
          },
        },
      },
    }
  }
  throw new Error(`Unsupported extension target: ${target}`)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
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

async function writeBuildManifest(targetDirectory, target) {
  const files = await walkFiles(targetDirectory)
  const fileRecords = {}
  for (const file of files) {
    const bytes = await readFile(file.absolutePath)
    fileRecords[file.relativePath] = { byteLength: bytes.byteLength, sha256: sha256(bytes) }
  }
  await writeFile(
    path.join(targetDirectory, 'build-manifest.json'),
    `${JSON.stringify({ target, version, files: fileRecords }, null, 2)}\n`,
  )
  return fileRecords
}

export async function auditBuiltExtension(targetDirectory, target) {
  const manifest = JSON.parse(await readFile(path.join(targetDirectory, 'manifest.json'), 'utf8'))
  const expectedBackground = target === 'chromium' ? manifest.background?.service_worker : manifest.background?.scripts?.[0]
  if (expectedBackground !== 'background.js') {
    throw new Error(`${target} background declaration is invalid`)
  }
  if (!manifest.content_security_policy?.extension_pages.includes("script-src 'self'")) {
    throw new Error(`${target} extension CSP does not restrict scripts to the package`)
  }
  const expectedPermissions = target === 'chromium' ? ['offscreen', 'storage'] : ['storage']
  if ([...manifest.permissions].sort().join(',') !== expectedPermissions.join(',')) {
    throw new Error(`${target} package requests unexpected API permissions`)
  }
  const expectedHosts = [...contentMatches, 'https://models.ngnl.host/*'].sort()
  if ([...manifest.host_permissions].sort().join(',') !== expectedHosts.join(',')) {
    throw new Error(`${target} package requests unexpected host permissions`)
  }
  const files = await walkFiles(targetDirectory)
  const relativeFiles = new Set(files.map((file) => file.relativePath))
  for (const required of ['background.js', 'content.js', 'inference-worker.js', 'options.html', 'options.js', `runtime/${runtimeWasmFilename}`]) {
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
  for (const file of files.filter((candidate) => candidate.relativePath.endsWith('.html'))) {
    const source = await readFile(file.absolutePath, 'utf8')
    if (/<(?:script|link)\b[^>]+(?:src|href)=["']https?:/iu.test(source)) {
      throw new Error(`${file.relativePath} references remote executable content`)
    }
    for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)) {
      if (match[1]?.trim()) {
        throw new Error(`${file.relativePath} contains inline script content`)
      }
    }
  }
  for (const file of files.filter((candidate) => candidate.relativePath.endsWith('.js'))) {
    const source = await readFile(file.absolutePath, 'utf8')
    if (/\bimport\s*\(/u.test(source)) {
      throw new Error(`${file.relativePath} contains a dynamic import`)
    }
    if (/https?:\/\/[^"'\s]+\.(?:m?js|wasm)(?:[?"'\s]|$)/iu.test(source)) {
      throw new Error(`${file.relativePath} references remote executable code`)
    }
  }
}

async function createArchive(targetDirectory, outputRoot, target) {
  const files = await walkFiles(targetDirectory)
  const entries = {}
  for (const file of files) {
    entries[file.relativePath] = [new Uint8Array(await readFile(file.absolutePath)), { mtime: deterministicZipTimestamp }]
  }
  const archiveName = `hv-pony-solver-${target}-${version}.zip`
  const archiveBytes = zipSync(entries, { level: 9 })
  const archivePath = path.join(outputRoot, archiveName)
  await writeFile(archivePath, archiveBytes)
  const archiveHash = sha256(archiveBytes)
  await writeFile(`${archivePath}.sha256`, `${archiveHash}  ${archiveName}\n`)
  return { archiveName, byteLength: archiveBytes.byteLength, sha256: archiveHash }
}

async function buildTarget(outputRoot, target, fixtureHost = false) {
  const targetDirectory = path.join(outputRoot, target)
  await mkdir(targetDirectory, { recursive: true })
  const entryPoints = {
    background: path.join(
      extensionRoot,
      'src',
      'background',
      fixtureHost && target === 'chromium' ? 'chromium-fixture.ts' : target === 'chromium' ? 'chromium.ts' : 'firefox.ts',
    ),
    content: path.join(extensionRoot, 'src', 'content', 'main.ts'),
    options: path.join(extensionRoot, 'src', 'options', 'main.ts'),
  }
  if (target === 'chromium') {
    entryPoints.offscreen = path.join(extensionRoot, 'src', 'offscreen', 'main.ts')
  }
  await build({
    entryPoints,
    outdir: targetDirectory,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: target === 'chromium' ? ['chrome116'] : ['firefox140'],
    minify: true,
    legalComments: 'none',
    sourcemap: false,
    logLevel: 'warning',
  })
  await build({
    entryPoints: [path.join(extensionRoot, 'src', 'host', 'inference-worker-entry.ts')],
    outfile: path.join(targetDirectory, 'inference-worker.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: target === 'chromium' ? ['chrome116'] : ['firefox140'],
    minify: true,
    legalComments: 'none',
    sourcemap: false,
    logLevel: 'warning',
    alias: {
      'onnxruntime-web/wasm': runtimeGlueSource,
    },
    plugins: [extensionRuntimeGluePlugin()],
  })
  await cp(path.join(extensionRoot, 'public', 'options.html'), path.join(targetDirectory, 'options.html'))
  await cp(path.join(extensionRoot, 'public', 'options.css'), path.join(targetDirectory, 'options.css'))
  if (target === 'chromium') {
    await cp(path.join(extensionRoot, 'public', 'offscreen.html'), path.join(targetDirectory, 'offscreen.html'))
  }
  await mkdir(path.join(targetDirectory, 'runtime'), { recursive: true })
  await cp(runtimeWasmSource, path.join(targetDirectory, 'runtime', runtimeWasmFilename))
  await writeFile(path.join(targetDirectory, 'manifest.json'), `${JSON.stringify(createManifest(target), null, 2)}\n`)
  await auditBuiltExtension(targetDirectory, target)
  const files = await writeBuildManifest(targetDirectory, target)
  const archive = await createArchive(targetDirectory, outputRoot, target)
  await writeFile(
    path.join(outputRoot, `hv-pony-solver-${target}-${version}.artifact.json`),
    `${JSON.stringify({ target, version, archive, files }, null, 2)}\n`,
  )
}

export async function buildExtensions(options = {}) {
  const outputRoot = options.outputRoot ?? path.join(extensionRoot, 'dist')
  const targets = options.targets ?? ['chromium', 'firefox']
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(outputRoot, { recursive: true })
  await assertRuntimeAssets()
  for (const target of targets) {
    await buildTarget(outputRoot, target, options.fixtureHost === true)
  }
  return outputRoot
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  await buildExtensions()
}
