import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertBrowserVersionForRun,
  assertBrowserVersionsEquivalent,
  assertExactMinimumBrowserVersion,
  assertSupportedBrowserVersion,
  geckodriverArguments,
  parseFirefoxVersion,
  parseGeckodriverVersion,
  resolvePackagedChromiumHeadless,
  normalizeBrowserVersionForComparison,
} from './browser-support.mjs'

test('geckodriver version parsing accepts release output and fails closed', () => {
  assert.equal(parseGeckodriverVersion('geckodriver 0.37.1\n'), '0.37.1')
  assert.throws(() => parseGeckodriverVersion('unknown'), /Unable to parse/u)
})

test('desktop and Android browser floors remain distinct and executable', () => {
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

test('Firefox WebDriver version comparison normalizes only trailing zero components', () => {
  assert.equal(normalizeBrowserVersionForComparison('140.15.0'), '140.15')
  assert.equal(assertBrowserVersionsEquivalent('140.15.0', '140.15'), '140.15')
  assert.equal(assertBrowserVersionsEquivalent('140.15.0.0', '140.15'), '140.15')
  assert.throws(() => assertBrowserVersionsEquivalent('140.15.0', '140.15.1'), /Browser versions differ/u)
  assert.throws(() => normalizeBrowserVersionForComparison('140..15'), /Unable to normalize browser version/u)
})

test('geckodriver refuses invalid listening ports', () => {
  for (const port of [0, -1, 65_536, 1.5, Number.NaN, '4444']) {
    assert.throws(() => geckodriverArguments(port), /Invalid geckodriver port/u)
  }
})
