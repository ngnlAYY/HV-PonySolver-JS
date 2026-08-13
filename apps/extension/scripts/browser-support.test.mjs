import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertSupportedBrowserVersion,
  browserSupport,
  firefoxArguments,
  geckodriverArguments,
  parseGeckodriverVersion,
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

test('manifest floor, build target and E2E floor share one source', () => {
  assert.deepEqual(browserSupport.chromium, {
    manifestMinimumVersion: '116',
    minimumMajor: 116,
    esbuildTarget: 'chrome116',
  })
  assert.deepEqual(browserSupport.firefox, {
    manifestMinimumVersion: '142.0',
    minimumMajor: 142,
    esbuildTarget: 'firefox142',
  })
  assert.equal(assertSupportedBrowserVersion('chromium', '116.0.1'), 116)
  assert.equal(assertSupportedBrowserVersion('firefox', '153.0'), 153)
  assert.throws(() => assertSupportedBrowserVersion('firefox', '141.9'), /below the supported major 142/u)
})

test('driver owns the system-access flag and Firefox capabilities do not', () => {
  assert.deepEqual(geckodriverArguments(4444), ['--allow-system-access', '--port', '4444'])
  assert.deepEqual(firefoxArguments(), ['-headless'])
  assert.equal(firefoxArguments().includes('-remote-allow-system-access'), false)
  assert.throws(() => geckodriverArguments(0), /Invalid geckodriver port/u)
})
