import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { firefox } from '@playwright/test'
import { cmd as webExt } from 'web-ext'

const packageRoot = resolve(fileURLToPath(new globalThis.URL('..', import.meta.url)))
const sourceDir = resolve(packageRoot, 'dist/firefox')
const firefoxBinary = process.env.FIREFOX_EXECUTABLE_PATH || firefox.executablePath()

if (!existsSync(resolve(sourceDir, 'manifest.json'))) {
  throw new Error('Firefox extension artifact is missing; run the extension build first')
}
if (!existsSync(firefoxBinary)) {
  throw new Error('Firefox executable is missing; install Playwright Firefox or set FIREFOX_EXECUTABLE_PATH')
}

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
  process.stdout.write('Firefox extension temporarily loaded and reloaded successfully.\n')
} finally {
  await runner?.exit().catch(() => undefined)
}
