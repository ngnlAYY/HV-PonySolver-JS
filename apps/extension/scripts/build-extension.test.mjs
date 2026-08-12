import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { unzipSync } from 'fflate'

import { auditBuiltExtension, buildExtensions, createManifest } from './build-extension.mjs'

test('creates target-specific MV3 manifests', () => {
  const chromium = createManifest('chromium')
  const firefox = createManifest('firefox')

  assert.equal(chromium.minimum_chrome_version, '116')
  assert.equal(chromium.background.service_worker, 'background.js')
  assert.ok(chromium.permissions.includes('offscreen'))
  assert.deepEqual(firefox.background.scripts, ['background.js'])
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, '142.0')
  assert.equal('default_popup' in chromium.action, false)
  assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions.required, ['authenticationInfo'])
  assert.equal('service_worker' in firefox.background, false)
})

test('builds auditable Chromium and Firefox archives with packaged runtime assets', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-extension-'))
  const comparisonRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-extension-repeat-'))
  try {
    await buildExtensions({ outputRoot: temporaryRoot })
    await buildExtensions({ outputRoot: comparisonRoot })
    await auditBuiltExtension(path.join(temporaryRoot, 'chromium'), 'chromium')
    await auditBuiltExtension(path.join(temporaryRoot, 'firefox'), 'firefox')

    for (const target of ['chromium', 'firefox']) {
      const archiveName = `hv-pony-solver-${target}-0.1.0.zip`
      const archiveBytes = await readFile(path.join(temporaryRoot, archiveName))
      assert.deepEqual(archiveBytes, await readFile(path.join(comparisonRoot, archiveName)))
      const archive = unzipSync(new Uint8Array(archiveBytes))
      assert.ok(archive['manifest.json'])
      assert.ok(archive['inference-worker.js'])
      assert.ok(Object.keys(archive).some((name) => name.startsWith('runtime/') && name.endsWith('.wasm')))
      const checksum = await readFile(path.join(temporaryRoot, `${archiveName}.sha256`), 'utf8')
      assert.match(checksum, /^[a-f0-9]{64} {2}hv-pony-solver-/)
      const artifact = JSON.parse(
        await readFile(path.join(temporaryRoot, `hv-pony-solver-${target}-0.1.0.artifact.json`), 'utf8'),
      )
      assert.equal(artifact.archive.archiveName, archiveName)
      assert.equal(artifact.archive.byteLength, archiveBytes.byteLength)
      assert.match(artifact.files['inference-worker.js'].sha256, /^[a-f0-9]{64}$/)
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
    await rm(comparisonRoot, { recursive: true, force: true })
  }
})
