import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { firefox } from '@playwright/test'
import { cmd as webExt } from 'web-ext'

import { assertBrowserVersionForRun, parseFirefoxVersion } from './browser-support.mjs'

const execFile = promisify(execFileCallback)
const packageRoot = resolve(fileURLToPath(new globalThis.URL('..', import.meta.url)))
const sourceDir = resolve(packageRoot, 'dist/firefox')
const firefoxBinary = process.env.FIREFOX_EXECUTABLE_PATH || firefox.executablePath()

if (!existsSync(resolve(sourceDir, 'manifest.json'))) {
  throw new Error('Firefox extension artifact is missing; run the extension build first')
}
if (!existsSync(firefoxBinary)) {
  throw new Error('Firefox executable is missing; install Playwright Firefox or set FIREFOX_EXECUTABLE_PATH')
}
const buildManifest = JSON.parse(await readFile(resolve(sourceDir, 'build-manifest.json'), 'utf8'))
if (buildManifest.target !== 'firefox' || buildManifest.modelDelivery !== 'remote') {
  throw new Error('Firefox remote load-only smoke requires a Firefox remote-model build')
}
const versionProcess = await execFile(firefoxBinary, ['--version'])
const browserVersion = parseFirefoxVersion(`${versionProcess.stdout}\n${versionProcess.stderr}`)
assertBrowserVersionForRun('firefox', browserVersion, process.env)

let runner
try {
  runner = await webExt.run({
    args: ['-headless'],
    firefox: firefoxBinary,
    noInput: true,
    noReload: true,
    sourceDir,
    target: ['firefox-desktop'],
  })
  const reloadResults = await runner.reloadAllExtensions()
  const reloadFailure = reloadResults.find((result) => result.reloadError instanceof Error)?.reloadError
  if (reloadFailure instanceof Error) {
    throw reloadFailure
  }
  process.stdout.write(
    `Firefox ${browserVersion} remote extension load-only smoke passed; authenticated model download and inference were NOT tested.\n`,
  )
} finally {
  await runner?.exit().catch(() => undefined)
}
