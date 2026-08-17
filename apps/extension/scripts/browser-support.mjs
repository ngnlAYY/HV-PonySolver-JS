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
    esbuildTarget: 'firefox140',
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

export function assertSupportedBrowserVersion(browser, version) {
  const support = browserSupport[browser]
  if (!support) {
    throw new Error(`Unsupported browser identity: ${browser}`)
  }
  const match = String(version).match(/^(\d+)(?:\.|$)/u)
  const major = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN
  if (!Number.isSafeInteger(major) || major < support.minimumMajor) {
    throw new Error(
      `${browser} ${version || 'unknown'} is below the supported major ${support.minimumMajor}`,
    )
  }
  return major
}
