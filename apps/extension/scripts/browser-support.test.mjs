import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assertBrowserVersionForRun,
  assertExactMinimumBrowserVersion,
  assertSupportedBrowserVersion,
  browserSupport,
  firefoxArguments,
  geckodriverArguments,
  parseFirefoxVersion,
  parseGeckodriverVersion,
  resolvePackagedChromiumHeadless,
} from './browser-support.mjs'

test('driver URL, version and checksum are pinned', () => {
  assert.deepEqual(browserSupport.geckodriver, {
    version: '0.37.1',
    linuxArchiveUrl:
      'https://github.com/mozilla/geckodriver/releases/download/v0.37.1/geckodriver-v0.37.1-linux64.tar.gz',
    linuxArchiveSha256: 'e815130ea95983e162ae91843b48d3a3ce991735635fce83a647afde21e09f7e',
  })
  assert.equal(parseGeckodriverVersion('geckodriver 0.37.1\n'), '0.37.1')
  assert.throws(() => parseGeckodriverVersion('unknown'), /Unable to parse/u)
})

test('desktop and Android browser floors remain distinct and executable', () => {
  assert.deepEqual(browserSupport.chromium, {
    manifestMinimumVersion: '116',
    minimumMajor: 116,
    esbuildTarget: 'chrome116',
  })
  assert.deepEqual(browserSupport.firefox, {
    manifestMinimumVersion: '140.0',
    androidManifestMinimumVersion: '142.0',
    minimumMajor: 140,
    androidMinimumMajor: 142,
    esbuildTarget: 'firefox140',
  })
  assert.deepEqual(browserSupport['firefox-android'], {
    manifestMinimumVersion: '142.0',
    minimumMajor: 142,
  })
  assert.equal(assertSupportedBrowserVersion('chromium', '116.0.5845.96'), 116)
  assert.equal(assertSupportedBrowserVersion('firefox', '153.0'), 153)
  assert.throws(() => assertSupportedBrowserVersion('firefox', '139.9'), /below the supported major 140/u)
  assert.throws(() => assertSupportedBrowserVersion('firefox-android', '141.9'), /below the supported major 142/u)
})

test('exact-minimum mode cannot be satisfied by a newer current browser', () => {
  assert.equal(assertExactMinimumBrowserVersion('chromium', '116.0.5845.96'), 116)
  assert.equal(assertExactMinimumBrowserVersion('firefox', '140.0.4'), 140)
  assert.equal(assertExactMinimumBrowserVersion('firefox-android', '142.0'), 142)
  assert.throws(() => assertExactMinimumBrowserVersion('chromium', '140.0'), /not the executable minimum major 116/u)
  assert.throws(
    () => assertBrowserVersionForRun('firefox', '153.0', { REQUIRE_EXACT_MINIMUM_BROWSER: 'true' }),
    /not the executable minimum major 140/u,
  )
  assert.equal(assertBrowserVersionForRun('firefox', '153.0', { REQUIRE_EXACT_MINIMUM_BROWSER: 'false' }), 153)
  assert.throws(
    () => assertBrowserVersionForRun('firefox', '140.0', { REQUIRE_EXACT_MINIMUM_BROWSER: 'yes' }),
    /must be true or false/u,
  )
})

test('packaged Chromium headed mode is explicit and fails closed', () => {
  assert.equal(resolvePackagedChromiumHeadless({}), true)
  assert.equal(resolvePackagedChromiumHeadless({ PACKAGED_E2E_HEADLESS: 'true' }), true)
  assert.equal(resolvePackagedChromiumHeadless({ PACKAGED_E2E_HEADLESS: 'false' }), false)
  assert.throws(() => resolvePackagedChromiumHeadless({ PACKAGED_E2E_HEADLESS: 'yes' }), /must be true or false/u)
})

test('Firefox version parsing accepts release output and fails closed', () => {
  assert.equal(parseFirefoxVersion('Mozilla Firefox 140.0.4\n'), '140.0.4')
  assert.equal(parseFirefoxVersion('Firefox 142.0'), '142.0')
  assert.throws(() => parseFirefoxVersion('Mozilla browser'), /Unable to parse Firefox version/u)
})

test('driver owns the system-access flag and Firefox capabilities do not', () => {
  assert.deepEqual(geckodriverArguments(4444), ['--allow-system-access', '--port', '4444'])
  assert.deepEqual(firefoxArguments(), ['-headless'])
  assert.equal(firefoxArguments().includes('-remote-allow-system-access'), false)
  assert.throws(() => geckodriverArguments(0), /Invalid geckodriver port/u)
})

test('Chromium smoke scripts retain real BFCache and service-worker lifecycle evidence', async () => {
  const [contentSmoke, packagedSmoke] = await Promise.all([
    readFile(new globalThis.URL('./chromium-content-smoke.mjs', import.meta.url), 'utf8'),
    readFile(new globalThis.URL('./chromium-packaged-model-smoke.mjs', import.meta.url), 'utf8'),
  ])

  assert.match(contentSmoke, /ignoreDefaultArgs: \['--disable-back-forward-cache'\]/u)
  assert.match(contentSmoke, /Page\.backForwardCacheNotUsed/u)
  assert.match(contentSmoke, /pagehide\?\.includes\(true\)/u)
  assert.match(contentSmoke, /pageshow\?\.includes\(true\)/u)
  assert.doesNotMatch(contentSmoke, /\.reload\(/u)

  assert.match(packagedSmoke, /ServiceWorker\.stopWorker/u)
  assert.match(packagedSmoke, /Target\.getTargetInfo/u)
  assert.match(packagedSmoke, /Offscreen document did not close after warm-idle timeout/u)
  assert.match(packagedSmoke, /推理请求中/u)
  assert.doesNotMatch(packagedSmoke, /Debugger\.pause/u)
  assert.doesNotMatch(packagedSmoke, /chrome\.offscreen\.closeDocument/u)
})
