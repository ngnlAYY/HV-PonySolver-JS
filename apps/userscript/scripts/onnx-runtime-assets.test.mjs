import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  parseOnnxRuntimeAssetsManifest,
  readFirstExistingOnnxRuntimeAssetStats,
  readOnnxRuntimeAssetsManifest,
  resolveInstalledOnnxRuntimeAssetPathCandidates,
} from './onnx-runtime-assets.mjs'
import { verifyOnnxRuntimeCdn, verifyRemoteAsset } from './verify-onnx-runtime-cdn.mjs'

const appDir = resolve(import.meta.dirname, '..')
const verifyScriptPath = resolve(appDir, 'scripts/verify-onnx-runtime-assets.mjs')

test('parseOnnxRuntimeAssetsManifest reads canonical runtime asset fields', () => {
  const bytes = Buffer.from([1, 2, 3])
  const manifest = parseOnnxRuntimeAssetsManifest(createManifestSource(bytes), {
    sourcePath: 'apps/userscript/src/inference/onnx-runtime-assets.ts',
  })

  assert.equal(manifest.packageName, 'onnxruntime-web')
  assert.equal(manifest.packageVersion, '1.26.0')
  assert.equal(manifest.scriptAsset.path, 'dist/ort.min.js')
  assert.equal(manifest.scriptAsset.filename, 'ort.min.js')
  assert.equal(manifest.scriptAsset.byteLength, 3)
  assert.equal(manifest.scriptAsset.sha256, sha256(bytes))
  assert.equal(manifest.scriptAsset.maxByteLength, 2_097_152)
  assert.equal(manifest.wasmAssets.length, 1)
  assert.equal(manifest.wasmAssets[0].path, 'dist/ort-wasm-simd-threaded.wasm')
  assert.equal(manifest.wasmAssets[0].filename, 'ort-wasm-simd-threaded.wasm')
  assert.equal(manifest.wasmAssets[0].byteLength, 2)
  assert.equal(manifest.wasmAssets[0].sha256, sha256(Buffer.from([9, 8])))
  assert.equal(manifest.cdn.scriptUrl, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js')
  assert.equal(manifest.cdn.wasmPath, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/')
})

test('parseOnnxRuntimeAssetsManifest ignores decoy properties outside ONNX_RUNTIME_ASSETS', () => {
  const bytes = Buffer.from([1, 2, 3])
  const source = `const decoy = {
  packageName: 'wrong-runtime',
  packageVersion: '0.0.0',
  scriptAsset: {
    path: 'dist/wrong.js',
    filename: 'wrong.js',
    byteLength: 999,
    sha256: '${'0'.repeat(64)}',
    maxByteLength: 999,
  },
  cdn: {
    scriptUrl: 'https://example.invalid/wrong.js',
    wasmPath: 'https://example.invalid/',
  },
}
${createManifestSource(bytes)}`

  const manifest = parseOnnxRuntimeAssetsManifest(source)

  assert.equal(manifest.packageName, 'onnxruntime-web')
  assert.equal(manifest.packageVersion, '1.26.0')
  assert.equal(manifest.scriptAsset.path, 'dist/ort.min.js')
  assert.equal(manifest.cdn.scriptUrl, 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js')
})

test('parseOnnxRuntimeAssetsManifest rejects scriptUrl drift from package facts', () => {
  const sourcePath = 'fixture/onnx-runtime-assets.ts'
  const source = createManifestSource(Buffer.from([1, 2, 3])).replace(
    'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js',
    'https://example.invalid/ort.min.js',
  )

  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(source, { sourcePath }),
    new RegExp(`Invalid ONNX_RUNTIME_ASSETS\\.cdn\\.scriptUrl in ${sourcePath}`),
  )
})

test('parseOnnxRuntimeAssetsManifest rejects wasmPath drift from package facts', () => {
  const sourcePath = 'fixture/onnx-runtime-assets.ts'
  const source = createManifestSource(Buffer.from([1, 2, 3])).replace(
    "wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/'",
    "wasmPath: 'https://example.invalid/dist/'",
  )

  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(source, { sourcePath }),
    new RegExp(`Invalid ONNX_RUNTIME_ASSETS\\.cdn\\.wasmPath in ${sourcePath}`),
  )
})

test('parseOnnxRuntimeAssetsManifest rejects duplicate script asset properties', () => {
  const sourcePath = 'fixture/onnx-runtime-assets.ts'
  const source = createManifestSource(Buffer.from([1, 2, 3])).replace(
    "path: 'dist/ort.min.js',",
    "path: 'dist/ort.min.js',\n    path: 'dist/other.js',",
  )

  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(source, { sourcePath }),
    new RegExp(`Duplicate ONNX_RUNTIME_ASSETS\\.scriptAsset\\.path in ${sourcePath}`),
  )
})

test('parseOnnxRuntimeAssetsManifest ignores decoy fields in comments and strings', () => {
  const bytes = Buffer.from([1, 2, 3])
  const source = createManifestSource(bytes).replace(
    "scriptAsset: {",
    "scriptAsset: {\n    // path: 'dist/evil.js'\n    /* filename: 'evil.js' */\n    raw: `byteLength: 999`,",
  )

  const manifest = parseOnnxRuntimeAssetsManifest(source)

  assert.equal(manifest.scriptAsset.path, 'dist/ort.min.js')
  assert.equal(manifest.scriptAsset.filename, 'ort.min.js')
  assert.equal(manifest.scriptAsset.byteLength, bytes.byteLength)
})

test('parseOnnxRuntimeAssetsManifest rejects string expression prefixes', () => {
  const sourcePath = 'fixture/onnx-runtime-assets.ts'
  const source = createManifestSource(Buffer.from([1, 2, 3])).replace(
    "packageName: 'onnxruntime-web',",
    "packageName: process.env.NAME || 'onnxruntime-web',",
  )

  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(source, { sourcePath }),
    new RegExp(`Unable to read ONNX_RUNTIME_ASSETS\\.packageName from ${sourcePath}`),
  )
})

for (const numericLiteral of ['3abc', '3.1', '3e1', '3n', '3_', '0x3']) {
  test(`parseOnnxRuntimeAssetsManifest rejects malformed numeric literal ${numericLiteral}`, () => {
    const sourcePath = 'fixture/onnx-runtime-assets.ts'
    const source = createManifestSource(Buffer.from([1, 2, 3])).replace('byteLength: 3,', `byteLength: ${numericLiteral},`)

    assert.throws(
      () => parseOnnxRuntimeAssetsManifest(source, { sourcePath }),
      new RegExp(`Invalid ONNX_RUNTIME_ASSETS\\.scriptAsset\\.byteLength in ${sourcePath}`),
    )
  })
}

test('resolveInstalledOnnxRuntimeAssetPathCandidates checks hoisted and app-local installs', () => {
  const manifest = parseOnnxRuntimeAssetsManifest(createManifestSource(Buffer.from([1, 2, 3])))
  const candidates = resolveInstalledOnnxRuntimeAssetPathCandidates(manifest, '/repo')

  assert.deepEqual(candidates, [
    resolve('/repo/node_modules/onnxruntime-web/dist/ort.min.js'),
    resolve('/repo/apps/userscript/node_modules/onnxruntime-web/dist/ort.min.js'),
  ])
})

test('readFirstExistingOnnxRuntimeAssetStats reads hoisted runtime asset candidates', async () => {
  const fixture = await createCliFixture()
  try {
    const bytes = Buffer.from([1, 2, 3])
    await writeHoistedRuntimeAsset(fixture.root, bytes)

    const result = await readFirstExistingOnnxRuntimeAssetStats([
      join(fixture.root, 'apps/userscript/node_modules/onnxruntime-web/dist/ort.min.js'),
      join(fixture.root, 'node_modules/onnxruntime-web/dist/ort.min.js'),
    ])

    assert.equal(result.filePath, join(fixture.root, 'node_modules/onnxruntime-web/dist/ort.min.js'))
    assert.equal(result.stats.byteLength, bytes.byteLength)
    assert.equal(result.stats.sha256, sha256(bytes))
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('parseOnnxRuntimeAssetsManifest rejects missing byteLength with source path', () => {
  const sourcePath = 'fixture/onnx-runtime-assets.ts'
  const source = createManifestSource(Buffer.from([1, 2, 3])).replace(/\n\s*byteLength: 3,/, '')

  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(source, { sourcePath }),
    new RegExp(`Unable to read ONNX_RUNTIME_ASSETS\\.scriptAsset\\.byteLength from ${sourcePath}`),
  )
})

test('parseOnnxRuntimeAssetsManifest rejects invalid sha256', () => {
  const sourcePath = 'fixture/onnx-runtime-assets.ts'
  const source = createManifestSource(Buffer.from([1, 2, 3])).replace(
    /sha256: '[0-9a-f]{64}'/,
    `sha256: '${'A'.repeat(64)}'`,
  )

  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(source, { sourcePath }),
    new RegExp(`Invalid ONNX_RUNTIME_ASSETS\\.scriptAsset\\.sha256 in ${sourcePath}`),
  )
})

test('readOnnxRuntimeAssetsManifest reads manifests from repo root', async () => {
  const fixture = await createCliFixture()
  try {
    const bytes = Buffer.from([1, 2, 3])
    await writeCanonicalManifest(fixture.root, bytes)

    const manifest = await readOnnxRuntimeAssetsManifest(fixture.root)

    assert.equal(manifest.scriptAsset.byteLength, bytes.byteLength)
    assert.equal(manifest.scriptAsset.sha256, sha256(bytes))
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('parseOnnxRuntimeAssetsManifest rejects invalid wasm asset sha256', () => {
  const sourcePath = 'fixture/onnx-runtime-assets.ts'
  const source = createManifestSource(Buffer.from([1, 2, 3])).replace(
    /sha256: '[0-9a-f]{64}',\n {4}},\n {2}],/,
    `sha256: '${'A'.repeat(64)}',\n    },\n  ],`,
  )

  assert.throws(
    () => parseOnnxRuntimeAssetsManifest(source, { sourcePath }),
    new RegExp(`Invalid ONNX_RUNTIME_ASSETS\\.wasmAssets\\[0\\]\\.sha256 in ${sourcePath}`),
  )
})

test('verify-onnx-runtime-assets CLI exits 0 for matching local JS and WASM assets', async () => {
  const fixture = await createCliFixture()
  try {
    const bytes = Buffer.from([1, 2, 3])
    const wasmBytes = Buffer.from([9, 8])
    await writeCanonicalManifest(fixture.root, bytes)
    await writeRuntimeAsset(fixture.root, bytes)
    await writeWasmAsset(fixture.root, wasmBytes)

    const result = await runCli(['--repo-root', fixture.root])

    assert.equal(result.code, 0)
    assert.match(result.stdout, /ONNX Runtime assets verified/)
    assert.match(result.stdout, /ort\.min\.js/)
    assert.match(result.stdout, /ort-wasm-simd-threaded\.wasm/)
    assert.match(result.stdout, /byteLength=3/)
    assert.match(result.stdout, /byteLength=2/)
    assert.equal(result.stderr, '')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('verify-onnx-runtime-assets CLI exits 1 for mismatched local WASM asset', async () => {
  const fixture = await createCliFixture()
  try {
    await writeCanonicalManifest(fixture.root, Buffer.from([1, 2, 3]))
    await writeRuntimeAsset(fixture.root, Buffer.from([1, 2, 3]))
    await writeWasmAsset(fixture.root, Buffer.from([7]))

    const result = await runCli(['--repo-root', fixture.root])

    assert.equal(result.code, 1)
    assert.match(result.stderr, /ONNX Runtime asset integrity mismatch: ort-wasm-simd-threaded\.wasm/)
    assert.match(result.stderr, /Expected: byteLength: 2/)
    assert.match(result.stderr, /Actual: byteLength: 1/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('verifyOnnxRuntimeCdn verifies JS runtime and WASM assets through manifest URLs', async () => {
  const fixture = await createCliFixture()
  try {
    const bytes = Buffer.from([1, 2, 3])
    const wasmBytes = Buffer.from([9, 8])
    const responses = new Map([
      ['https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js', bytes],
      ['https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.wasm', wasmBytes],
    ])
    const requested = []
    await writeCanonicalManifest(fixture.root, bytes)

    await verifyOnnxRuntimeCdn({
      repoRoot: fixture.root,
      fetchImpl: async (url, init) => {
        requested.push([url, init])
        const body = responses.get(url)
        return {
          ok: Boolean(body),
          status: body ? 200 : 404,
          arrayBuffer: async () => body,
        }
      },
    })

    assert.deepEqual(requested, [
      ['https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js', { cache: 'no-store' }],
      ['https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort-wasm-simd-threaded.wasm', { cache: 'no-store' }],
    ])
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('verifyRemoteAsset rejects CDN HTTP failures', async () => {
  await assert.rejects(
    verifyRemoteAsset('https://cdn.example.invalid/ort.min.js', {
      byteLength: 3,
      sha256: sha256(Buffer.from([1, 2, 3])),
    }, async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => Buffer.from([]),
    })),
    /ONNX Runtime CDN asset failed: https:\/\/cdn\.example\.invalid\/ort\.min\.js HTTP 404/,
  )
})

test('verifyRemoteAsset rejects CDN asset byteLength mismatch', async () => {
  await assert.rejects(
    verifyRemoteAsset('https://cdn.example.invalid/ort.min.js', {
      byteLength: 3,
      sha256: sha256(Buffer.from([1, 2, 3])),
    }, async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from([1, 2]),
    })),
    /ONNX Runtime CDN asset size mismatch: https:\/\/cdn\.example\.invalid\/ort\.min\.js/,
  )
})

test('verifyOnnxRuntimeCdn rejects CDN asset SHA-256 mismatch', async () => {
  const fixture = await createCliFixture()
  try {
    await writeCanonicalManifest(fixture.root, Buffer.from([1, 2, 3]))

    await assert.rejects(
      verifyOnnxRuntimeCdn({
        repoRoot: fixture.root,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          arrayBuffer: async () => Buffer.from([4, 5, 6]),
        }),
      }),
      /ONNX Runtime CDN asset SHA-256 mismatch/,
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('verify-onnx-runtime-assets CLI exits 0 for a matching local runtime asset and canonical manifest', async () => {
  const fixture = await createCliFixture()
  try {
    const bytes = Buffer.from([1, 2, 3])
    await writeCanonicalManifest(fixture.root, bytes)
    await writeRuntimeAsset(fixture.root, bytes)
    await writeWasmAsset(fixture.root, Buffer.from([9, 8]))

    const result = await runCli(['--repo-root', fixture.root])

    assert.equal(result.code, 0)
    assert.match(result.stdout, /ONNX Runtime assets verified/)
    assert.match(result.stdout, /ort\.min\.js/)
    assert.match(result.stdout, /byteLength=3/)
    assert.match(result.stdout, new RegExp(sha256(bytes)))
    assert.equal(result.stderr, '')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('verify-onnx-runtime-assets CLI exits 0 for a matching hoisted runtime asset', async () => {
  const fixture = await createCliFixture()
  try {
    const bytes = Buffer.from([1, 2, 3])
    await writeCanonicalManifest(fixture.root, bytes)
    await writeHoistedRuntimeAsset(fixture.root, bytes)
    await writeHoistedWasmAsset(fixture.root, Buffer.from([9, 8]))

    const result = await runCli(['--repo-root', fixture.root])

    assert.equal(result.code, 0)
    assert.match(result.stdout, /ONNX Runtime assets verified/)
    assert.equal(result.stderr, '')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('verify-onnx-runtime-assets CLI exits 1 for manifest CDN drift', async () => {
  const fixture = await createCliFixture()
  try {
    const bytes = Buffer.from([1, 2, 3])
    await writeCanonicalManifest(
      fixture.root,
      bytes,
      createManifestSource(bytes).replace(
        'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js',
        'https://example.invalid/ort.min.js',
      ),
    )
    await writeRuntimeAsset(fixture.root, bytes)

    const result = await runCli(['--repo-root', fixture.root])

    assert.equal(result.code, 1)
    assert.match(result.stderr, /Invalid ONNX_RUNTIME_ASSETS\.cdn\.scriptUrl/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('verify-onnx-runtime-assets CLI exits 1 for mismatched byteLength and SHA-256', async () => {
  const fixture = await createCliFixture()
  try {
    await writeCanonicalManifest(fixture.root, Buffer.from([1, 2, 3]))
    await writeRuntimeAsset(fixture.root, Buffer.from([4, 5]))

    const result = await runCli(['--repo-root', fixture.root])

    assert.equal(result.code, 1)
    assert.match(result.stderr, /ONNX Runtime asset integrity mismatch/)
    assert.match(result.stderr, /Expected: byteLength: 3/)
    assert.match(result.stderr, /Actual: byteLength: 2/)
    assert.match(result.stderr, /sha256:/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('verify-onnx-runtime-assets CLI exits 1 when the runtime asset is missing', async () => {
  const fixture = await createCliFixture()
  try {
    await writeCanonicalManifest(fixture.root, Buffer.from([1, 2, 3]))

    const result = await runCli(['--repo-root', fixture.root])

    assert.equal(result.code, 1)
    assert.match(result.stderr, /ONNX Runtime asset does not exist in any checked location/)
    assert.match(result.stderr, /node_modules\/onnxruntime-web\/dist\/ort\.min\.js/)
    assert.match(result.stderr, /apps\/userscript\/node_modules\/onnxruntime-web\/dist\/ort\.min\.js/)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

async function createCliFixture() {
  const root = await mkdtemp(join(tmpdir(), 'hv-pony-onnx-runtime-assets-'))
  return { root }
}

async function writeCanonicalManifest(root, bytes, source = createManifestSource(bytes)) {
  const manifestPath = join(root, 'apps/userscript/src/inference/onnx-runtime-assets.ts')
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, source)
}

async function writeRuntimeAsset(root, bytes) {
  const assetPath = join(root, 'apps/userscript/node_modules/onnxruntime-web/dist/ort.min.js')
  await mkdir(dirname(assetPath), { recursive: true })
  await writeFile(assetPath, bytes)
}

async function writeHoistedRuntimeAsset(root, bytes) {
  const assetPath = join(root, 'node_modules/onnxruntime-web/dist/ort.min.js')
  await mkdir(dirname(assetPath), { recursive: true })
  await writeFile(assetPath, bytes)
}

async function writeWasmAsset(root, bytes) {
  const assetPath = join(root, 'apps/userscript/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm')
  await mkdir(dirname(assetPath), { recursive: true })
  await writeFile(assetPath, bytes)
}

async function writeHoistedWasmAsset(root, bytes) {
  const assetPath = join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm')
  await mkdir(dirname(assetPath), { recursive: true })
  await writeFile(assetPath, bytes)
}

function createManifestSource(bytes, wasmBytes = Buffer.from([9, 8])) {
  return `export const ONNX_RUNTIME_ASSETS = {
  packageName: 'onnxruntime-web',
  packageVersion: '1.26.0',
  scriptAsset: {
    path: 'dist/ort.min.js',
    filename: 'ort.min.js',
    byteLength: ${bytes.byteLength},
    sha256: '${sha256(bytes)}',
    maxByteLength: 2_097_152,
  },
  wasmAssets: [
    {
      path: 'dist/ort-wasm-simd-threaded.wasm',
      filename: 'ort-wasm-simd-threaded.wasm',
      byteLength: ${wasmBytes.byteLength},
      sha256: '${sha256(wasmBytes)}',
    },
  ],
  cdn: {
    scriptUrl: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js',
    wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/',
  },
} as const
`
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function runCli(args = []) {
  return new Promise((resolveRun) => {
    execFile(process.execPath, [verifyScriptPath, ...args], { cwd: appDir, env: process.env }, (error, stdout, stderr) => {
      resolveRun({
        code: error && typeof error.code === 'number' ? error.code : 0,
        stdout,
        stderr,
      })
    })
  })
}
