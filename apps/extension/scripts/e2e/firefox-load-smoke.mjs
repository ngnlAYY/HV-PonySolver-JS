import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { firefox } from '@playwright/test'
import { EXTENSION_PATHS } from '../../src/platform/extension-paths.ts'
import { findExecutable, startWebDriver, createWebDriverClient } from '../browser/webdriver.mjs'

import {
  assertBrowserVersionForRun,
  assertBrowserVersionsEquivalent,
  browserSupport,
  firefoxArguments,
  parseFirefoxVersion,
  parseGeckodriverVersion,
} from '../browser/browser-support.mjs'

const execFile = promisify(execFileCallback)
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outputRoot = path.resolve(packageRoot, 'dist')
const sourceDir = path.resolve(outputRoot, 'firefox')
const manifestPath = path.resolve(sourceDir, 'manifest.json')
const buildManifestPath = path.resolve(sourceDir, 'build-manifest.json')
const firefoxBinary = process.env.FIREFOX_EXECUTABLE_PATH || firefox.executablePath()
const addonId = 'hv-pony-solver@ngnl.host'
const extensionUuid = '11111111-2222-4333-8444-555555555555'

async function readJsonFile(filename, label) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is invalid: ${filename}`, { cause: error })
  }
}

await access(manifestPath)
await access(buildManifestPath)
const [manifest, buildManifest] = await Promise.all([
  readJsonFile(manifestPath, 'Firefox manifest'),
  readJsonFile(buildManifestPath, 'Firefox build manifest'),
])
if (buildManifest.target !== 'firefox' || buildManifest.modelDelivery !== 'remote') {
  throw new Error('Firefox load-only smoke requires a remote-model build')
}
assert.equal(manifest.version, buildManifest.version)
assert.equal(manifest.browser_specific_settings?.gecko?.id, addonId)
const archivePath = path.resolve(outputRoot, `hv-pony-solver-firefox-${buildManifest.version}.zip`)
await access(archivePath)
await access(firefoxBinary, constants.X_OK)

const versionProcess = await execFile(firefoxBinary, ['--version'])
const browserVersion = parseFirefoxVersion(`${versionProcess.stdout}\n${versionProcess.stderr}`)
assertBrowserVersionForRun('firefox', browserVersion)

const geckodriver = await findExecutable(process.env.GECKODRIVER_PATH || 'geckodriver')
const driverVersionProcess = await execFile(geckodriver, ['--version'])
const driverVersion = parseGeckodriverVersion(`${driverVersionProcess.stdout}\n${driverVersionProcess.stderr}`)
assert.equal(
  driverVersion,
  browserSupport.geckodriver.version,
  `Expected geckodriver ${browserSupport.geckodriver.version}, received ${driverVersion}`,
)

const driver = await startWebDriver(geckodriver)
const request = createWebDriverClient(driver.port)
let sessionId
try {
  const session = await request('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        'moz:firefoxOptions': {
          binary: firefoxBinary,
          args: firefoxArguments(),
          prefs: {
            'extensions.webextensions.uuids': JSON.stringify({ [addonId]: extensionUuid }),
          },
        },
      },
    },
  })
  sessionId = session.sessionId
  const sessionPath = `/session/${sessionId}`
  assertBrowserVersionsEquivalent(browserVersion, session.capabilities.browserVersion)
  await request('POST', `${sessionPath}/moz/addon/install`, { path: archivePath, temporary: true })
  await request('POST', `${sessionPath}/timeouts`, { script: 15_000, pageLoad: 60_000 })
  await request('POST', `${sessionPath}/moz/context`, { context: 'chrome' })
  const openOptionsResult = await request('POST', `${sessionPath}/execute/async`, {
    script: `
      const done = arguments[arguments.length - 1]
      const uri = arguments[0]
      ;(async () => {
        const window = Services.wm.getMostRecentWindow('navigator:browser')
        const tab = window.gBrowser.addTab(uri, {
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        })
        window.gBrowser.selectedTab = tab
        await new Promise((resolve) => setTimeout(resolve, 500))
        done({ ok: true })
      })().catch((error) => done({ error: String(error) }))
    `,
    args: [`moz-extension://${extensionUuid}/${EXTENSION_PATHS.optionsPage}`],
  })
  assert.deepEqual(openOptionsResult, { ok: true })
  await request('POST', `${sessionPath}/moz/context`, { context: 'content' })
  const handles = await request('GET', `${sessionPath}/window/handles`)
  await request('POST', `${sessionPath}/window`, { handle: handles.at(-1) })
  const optionsState = await request('POST', `${sessionPath}/execute/async`, {
    script: `
      const done = arguments[arguments.length - 1]
      const deadline = Date.now() + 10_000
      const poll = () => {
        const saveButton = document.querySelector('button[type="submit"]')
        const keyFieldset = document.querySelector('#model-key-fieldset')
        if (document.title === 'HV Pony Solver 设置' && saveButton && keyFieldset && !saveButton.disabled && !keyFieldset.disabled) {
          done({
            title: document.title,
            keyFieldsetDisabled: keyFieldset.disabled,
            keyInputDisabled: document.querySelector('#model-key')?.matches(':disabled'),
            quotaButtonDisabled: document.querySelector('#query-model-quota')?.matches(':disabled'),
            downloadButtonDisabled: document.querySelector('#download-model')?.matches(':disabled'),
            panelRequireCspChecked: document.querySelector('#panel-require-csp')?.checked,
            preserveCheckedAnswersChecked: document.querySelector('#preserve-checked-answers')?.checked,
            panelPosition: document.querySelector('#panel-position')?.value,
            packagedHintHidden: document.querySelector('#packaged-model-hint')?.hidden,
          })
          return
        }
        if (Date.now() > deadline) {
          done({ error: 'Firefox remote options did not initialize' })
          return
        }
        setTimeout(poll, 50)
      }
      poll()
    `,
    args: [],
  })
  assert.deepEqual(optionsState, {
    title: 'HV Pony Solver 设置',
    keyFieldsetDisabled: false,
    keyInputDisabled: false,
    quotaButtonDisabled: false,
    downloadButtonDisabled: false,
    panelRequireCspChecked: true,
    preserveCheckedAnswersChecked: true,
    panelPosition: '155,1240',
    packagedHintHidden: true,
  })
  process.stdout.write(
    `Firefox ${browserVersion} remote extension installed and its current settings controls were verified; authenticated model download and inference were NOT tested.\n`,
  )
} finally {
  if (sessionId) {
    await request('DELETE', `/session/${sessionId}`).catch(() => {})
  }
  await driver.stop()
}
