export const browserSupport = Object.freeze({
  chromium: Object.freeze({
    manifestMinimumVersion: '116',
    minimumMajor: 116,
    esbuildTarget: 'chrome116',
  }),
  firefox: Object.freeze({
    manifestMinimumVersion: '140.0',
    androidManifestMinimumVersion: '142.0',
    minimumMajor: 140,
    androidMinimumMajor: 142,
    esbuildTarget: 'firefox140',
  }),
  'firefox-android': Object.freeze({
    manifestMinimumVersion: '142.0',
    minimumMajor: 142,
  }),
  geckodriver: Object.freeze({
    version: '0.37.1',
    linuxArchiveUrl:
      'https://github.com/mozilla/geckodriver/releases/download/v0.37.1/geckodriver-v0.37.1-linux64.tar.gz',
    linuxArchiveSha256: 'e815130ea95983e162ae91843b48d3a3ce991735635fce83a647afde21e09f7e',
  }),
})

export function geckodriverArguments(port) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid geckodriver port: ${port}`)
  }
  return ['--allow-system-access', '--port', String(port)]
}

export function firefoxArguments() {
  return ['-headless']
}

export function parseGeckodriverVersion(output) {
  const match = String(output).match(/^geckodriver\s+(\d+\.\d+\.\d+)\b/mu)
  if (!match?.[1]) {
    throw new Error(`Unable to parse geckodriver version: ${String(output).trim()}`)
  }
  return match[1]
}

export function parseFirefoxVersion(output) {
  const match = String(output).match(/(?:Mozilla\s+)?Firefox\s+(\d+(?:\.\d+)+)\b/iu)
  if (!match?.[1]) {
    throw new Error(`Unable to parse Firefox version: ${String(output).trim()}`)
  }
  return match[1]
}

function parseBrowserMajor(browser, version) {
  const support = browserSupport[browser]
  if (!support || !Number.isSafeInteger(support.minimumMajor)) {
    throw new Error(`Unsupported browser identity: ${browser}`)
  }
  const match = String(version).match(/^(\d+)(?:\.|$)/u)
  const major = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN
  if (!Number.isSafeInteger(major)) {
    throw new Error(`Unable to parse ${browser} browser version: ${version || 'unknown'}`)
  }
  return { major, support }
}

export function assertSupportedBrowserVersion(browser, version) {
  const { major, support } = parseBrowserMajor(browser, version)
  if (major < support.minimumMajor) {
    throw new Error(`${browser} ${version || 'unknown'} is below the supported major ${support.minimumMajor}`)
  }
  return major
}

export function assertExactMinimumBrowserVersion(browser, version) {
  const { major, support } = parseBrowserMajor(browser, version)
  if (major !== support.minimumMajor) {
    throw new Error(`${browser} ${version || 'unknown'} is not the executable minimum major ${support.minimumMajor}`)
  }
  return major
}

export function resolvePackagedChromiumHeadless(environment = process.env) {
  const value = environment.PACKAGED_E2E_HEADLESS
  if (value !== undefined && !['true', 'false'].includes(value)) {
    throw new Error('PACKAGED_E2E_HEADLESS must be true or false')
  }
  return value !== 'false'
}

export function assertBrowserVersionForRun(browser, version, environment = process.env) {
  const exactMinimum = environment.REQUIRE_EXACT_MINIMUM_BROWSER
  if (exactMinimum !== undefined && !['true', 'false'].includes(exactMinimum)) {
    throw new Error('REQUIRE_EXACT_MINIMUM_BROWSER must be true or false')
  }
  return exactMinimum === 'true'
    ? assertExactMinimumBrowserVersion(browser, version)
    : assertSupportedBrowserVersion(browser, version)
}
