import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import test from 'node:test'

import { unzipSync } from 'fflate'

import {
  auditBuiltExtension,
  buildExtensions,
  buildPackagedFixtureExtensions,
  createManifest,
  parseBuildArguments,
  verifyPackagedModelFile,
} from './build-extension.mjs'

const modelFilename = 'yolo26n-640.ort'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertArchiveIntegrity({ archive, archiveBytes, archiveName, artifact, buildManifest, checksum }) {
  const checksumMatch = checksum.match(/^([a-f0-9]{64}) {2}([^\n]+)\n$/u)
  assert.ok(checksumMatch)
  assert.equal(checksumMatch[2], archiveName)
  assert.equal(checksumMatch[1], sha256(archiveBytes))
  assert.equal(artifact.archive.archiveName, archiveName)
  assert.equal(artifact.archive.byteLength, archiveBytes.byteLength)
  assert.equal(artifact.archive.sha256, checksumMatch[1])

  const archiveFiles = Object.keys(archive).filter((name) => name !== 'build-manifest.json').sort()
  assert.deepEqual(Object.keys(buildManifest.files).sort(), archiveFiles)
  assert.deepEqual(artifact.files, buildManifest.files)
  assert.equal('build-manifest.json' in buildManifest.files, false)
  for (const name of archiveFiles) {
    assert.deepEqual(buildManifest.files[name], {
      byteLength: archive[name].byteLength,
      sha256: sha256(archive[name]),
    })
  }
}

test('creates the exact remote and packaged manifest matrix without a WAR', () => {
  const remoteChromium = createManifest('chromium')
  const remoteFirefox = createManifest('firefox')
  const packagedChromium = createManifest('chromium', { modelDelivery: 'packaged' })
  const packagedFirefox = createManifest('firefox', { modelDelivery: 'packaged' })

  assert.equal(remoteChromium.minimum_chrome_version, '116')
  assert.equal(remoteChromium.background.service_worker, 'background.js')
  assert.deepEqual(remoteChromium.permissions, ['storage', 'offscreen'])
  assert.ok(remoteChromium.host_permissions.includes('https://models.ngnl.host/*'))
  assert.deepEqual(remoteFirefox.background.scripts, ['background.js'])
  assert.equal(remoteFirefox.browser_specific_settings.gecko.strict_min_version, '140.0')
  assert.equal(remoteFirefox.browser_specific_settings.gecko_android.strict_min_version, '142.0')
  assert.deepEqual(remoteFirefox.browser_specific_settings.gecko.data_collection_permissions.required, ['authenticationInfo'])
  assert.equal('service_worker' in remoteFirefox.background, false)
  assert.equal('persistent' in remoteFirefox.background, false)

  assert.deepEqual(packagedChromium.permissions, ['storage', 'offscreen'])
  assert.equal(packagedChromium.host_permissions.includes('https://models.ngnl.host/*'), false)
  assert.deepEqual(packagedFirefox.permissions, ['storage'])
  assert.equal(packagedFirefox.host_permissions.includes('https://models.ngnl.host/*'), false)
  assert.deepEqual(packagedFirefox.browser_specific_settings.gecko.data_collection_permissions.required, ['none'])
  assert.equal('persistent' in packagedFirefox.background, false)
  for (const manifest of [remoteChromium, remoteFirefox, packagedChromium, packagedFirefox]) {
    assert.equal('default_popup' in manifest.action, false)
    assert.equal('web_accessible_resources' in manifest, false)
  }
})

test('parses only one exact model-delivery selector in either CLI form', () => {
  assert.deepEqual(parseBuildArguments([]), { modelDelivery: 'remote' })
  assert.deepEqual(parseBuildArguments(['--model-mode', 'remote']), { modelDelivery: 'remote' })
  assert.deepEqual(parseBuildArguments(['--model-mode', 'packaged']), { modelDelivery: 'packaged' })
  assert.deepEqual(parseBuildArguments(['--model-mode=remote']), { modelDelivery: 'remote' })
  assert.deepEqual(parseBuildArguments(['--model-mode=packaged']), { modelDelivery: 'packaged' })

  assert.throws(() => parseBuildArguments(['--model-mode']), /requires remote or packaged/u)
  assert.throws(() => parseBuildArguments(['--model-mode=']), /requires remote or packaged/u)
  assert.throws(() => parseBuildArguments(['--model-mode', '--unknown']), /requires remote or packaged/u)
  assert.throws(() => parseBuildArguments(['--model-mode', 'other']), /Unsupported extension model delivery mode/u)
  assert.throws(() => parseBuildArguments(['--model-mode=other']), /Unsupported extension model delivery mode/u)
  assert.throws(() => parseBuildArguments(['--unknown']), /Unknown extension build argument/u)
  assert.throws(() => parseBuildArguments(['packaged']), /Unknown extension build argument/u)
  assert.throws(
    () => parseBuildArguments(['--model-mode=remote', '--model-mode', 'packaged']),
    /only once/u,
  )
})

test('validates packaged model file type, length, and SHA-256', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-model-source-'))
  const bytes = Uint8Array.from([1, 2, 3])
  const identity = { filename: modelFilename, byteLength: bytes.byteLength, sha256: sha256(bytes) }
  try {
    await assert.rejects(
      verifyPackagedModelFile(path.join(temporaryRoot, 'missing.ort'), identity),
      /Unable to inspect packaged model source/u,
    )
    const directoryPath = path.join(temporaryRoot, 'directory.ort')
    await mkdir(directoryPath)
    await assert.rejects(verifyPackagedModelFile(directoryPath, identity), /must be a regular file/u)

    const validPath = path.join(temporaryRoot, modelFilename)
    await writeFile(validPath, bytes)
    const linkPath = path.join(temporaryRoot, 'link.ort')
    await symlink(validPath, linkPath)
    await assert.rejects(verifyPackagedModelFile(linkPath, identity), /must not be a symbolic link/u)

    const shortPath = path.join(temporaryRoot, 'short.ort')
    await writeFile(shortPath, bytes.subarray(0, 2))
    await assert.rejects(verifyPackagedModelFile(shortPath, identity), /byte length mismatch/u)
    const longPath = path.join(temporaryRoot, 'long.ort')
    await writeFile(longPath, Uint8Array.from([1, 2, 3, 4]))
    await assert.rejects(verifyPackagedModelFile(longPath, identity), /byte length mismatch/u)
    const corruptPath = path.join(temporaryRoot, 'corrupt.ort')
    await writeFile(corruptPath, Uint8Array.from([3, 2, 1]))
    await assert.rejects(verifyPackagedModelFile(corruptPath, identity), /SHA-256 mismatch/u)

    const verified = await verifyPackagedModelFile(validPath, identity)
    assert.deepEqual([...verified.bytes], [...bytes])
    assert.deepEqual(verified.identity, identity)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('keeps default and explicit remote builds deterministic and model-free', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-extension-remote-'))
  const comparisonRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-extension-remote-repeat-'))
  try {
    await buildExtensions({ outputRoot: temporaryRoot })
    await buildExtensions({ outputRoot: comparisonRoot, modelDelivery: 'remote' })

    const rootFiles = await readdir(temporaryRoot)
    assert.equal(rootFiles.some((name) => name.includes('-packaged-')), false)
    for (const target of ['chromium', 'firefox']) {
      await auditBuiltExtension(path.join(temporaryRoot, target), target)
      const archiveName = `hv-pony-solver-${target}-0.1.0.zip`
      const archiveBytes = await readFile(path.join(temporaryRoot, archiveName))
      assert.deepEqual(archiveBytes, await readFile(path.join(comparisonRoot, archiveName)))
      const archive = unzipSync(new Uint8Array(archiveBytes))
      assert.ok(archive['manifest.json'])
      assert.ok(archive['inference-worker.js'])
      assert.ok(Object.keys(archive).some((name) => name.startsWith('runtime/') && name.endsWith('.wasm')))
      assert.equal(Object.keys(archive).some((name) => name.endsWith('.ort')), false)
      assert.equal('offscreen.html' in archive, target === 'chromium')
      assert.equal('offscreen.js' in archive, target === 'chromium')

      const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']))
      assert.ok(manifest.host_permissions.includes('https://models.ngnl.host/*'))
      assert.equal('web_accessible_resources' in manifest, false)
      const buildManifest = JSON.parse(new TextDecoder().decode(archive['build-manifest.json']))
      assert.equal(buildManifest.modelDelivery, 'remote')
      assert.equal('model' in buildManifest, false)
      assert.equal('fixture' in buildManifest, false)
      const artifact = JSON.parse(
        await readFile(path.join(temporaryRoot, `hv-pony-solver-${target}-0.1.0.artifact.json`), 'utf8'),
      )
      assert.equal(artifact.modelDelivery, 'remote')
      assert.equal('model' in artifact, false)
      assert.equal('fixture' in artifact, false)
      const checksum = await readFile(path.join(temporaryRoot, `${archiveName}.sha256`), 'utf8')
      assertArchiveIntegrity({ archive, archiveBytes, archiveName, artifact, buildManifest, checksum })
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
    await rm(comparisonRoot, { recursive: true, force: true })
  }
})

test('builds deterministic private packaged-model fixtures with distinct names and graphs', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-extension-packaged-'))
  const comparisonRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-extension-packaged-repeat-'))
  const bytes = Uint8Array.from([1, 2, 3, 4])
  const fixtureModelFilename = 'fixture-model.ort'
  const model = { filename: fixtureModelFilename, byteLength: bytes.byteLength, sha256: sha256(bytes) }
  try {
    await buildPackagedFixtureExtensions({ outputRoot: temporaryRoot, modelBytes: bytes, model })
    await buildPackagedFixtureExtensions({ outputRoot: comparisonRoot, modelBytes: bytes, model })

    for (const target of ['chromium', 'firefox']) {
      const buildManifestPath = path.join(temporaryRoot, target, 'build-manifest.json')
      const buildManifest = JSON.parse(await readFile(buildManifestPath, 'utf8'))
      await auditBuiltExtension(path.join(temporaryRoot, target), target, {
        modelDelivery: 'packaged',
        model,
        fixture: true,
      })
      const archiveName = `hv-pony-solver-${target}-packaged-fixture-0.1.0.zip`
      const archiveBytes = await readFile(path.join(temporaryRoot, archiveName))
      assert.deepEqual(archiveBytes, await readFile(path.join(comparisonRoot, archiveName)))
      const archive = unzipSync(new Uint8Array(archiveBytes))
      assert.deepEqual(archive[`model/${fixtureModelFilename}`], bytes)
      assert.equal(Object.keys(archive).filter((name) => name.endsWith('.ort')).length, 1)
      assert.equal('offscreen.html' in archive, target === 'chromium')
      assert.equal('offscreen.js' in archive, target === 'chromium')

      const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']))
      assert.equal(manifest.host_permissions.includes('https://models.ngnl.host/*'), false)
      assert.equal('web_accessible_resources' in manifest, false)
      assert.deepEqual(manifest.permissions, target === 'chromium' ? ['storage', 'offscreen'] : ['storage'])
      if (target === 'firefox') {
        assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none'])
      }
      const bundledJavaScript = Object.entries(archive)
        .filter(([name]) => name.endsWith('.js'))
        .map(([, source]) => new TextDecoder().decode(source))
        .join('\n')
      assert.doesNotMatch(
        bundledJavaScript,
        /https:\/\/models\.ngnl\.host|hvPonySolverExtensionSecrets|hvPonySolverModelAccessKey|Bearer /u,
      )
      assert.match(new TextDecoder().decode(archive['options.js']), /当前版本已内置模型，无需配置模型 Key。/u)

      assert.deepEqual(buildManifest, JSON.parse(new TextDecoder().decode(archive['build-manifest.json'])))
      assert.equal(buildManifest.modelDelivery, 'packaged')
      assert.equal(buildManifest.fixture, true)
      assert.deepEqual(buildManifest.model, model)
      assert.deepEqual(buildManifest.files[`model/${fixtureModelFilename}`], {
        byteLength: bytes.byteLength,
        sha256: model.sha256,
      })
      const artifact = JSON.parse(
        await readFile(path.join(temporaryRoot, `hv-pony-solver-${target}-packaged-fixture-0.1.0.artifact.json`), 'utf8'),
      )
      assert.equal(artifact.modelDelivery, 'packaged')
      assert.equal(artifact.fixture, true)
      assert.deepEqual(artifact.model, model)
      const checksum = await readFile(path.join(temporaryRoot, `${archiveName}.sha256`), 'utf8')
      assertArchiveIntegrity({ archive, archiveBytes, archiveName, artifact, buildManifest, checksum })
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
    await rm(comparisonRoot, { recursive: true, force: true })
  }
})

test('rejects invalid fixture input and targets before replacing existing output', async () => {
  for (const runInvalidBuild of [
    (outputRoot) => buildPackagedFixtureExtensions({
      outputRoot,
      modelBytes: Uint8Array.from([1, 2, 3]),
      model: { filename: modelFilename, byteLength: 3, sha256: '0'.repeat(64) },
    }),
    (outputRoot) => buildExtensions({ outputRoot, targets: ['fireofx'] }),
    (outputRoot) => buildExtensions({ outputRoot, targets: ['chromium', 'chromium'] }),
    (outputRoot) => buildExtensions({ outputRoot, targets: [] }),
  ]) {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-extension-preserve-'))
    const sentinelPath = path.join(outputRoot, 'sentinel.txt')
    await writeFile(sentinelPath, 'keep')
    try {
      await assert.rejects(runInvalidBuild(outputRoot))
      assert.equal(await readFile(sentinelPath, 'utf8'), 'keep')
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  }
})
