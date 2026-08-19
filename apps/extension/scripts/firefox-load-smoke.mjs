import assert from 'node:assert/strict'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { firefox } from '@playwright/test'

import {
  assertBrowserVersionForRun,
  browserSupport,
  firefoxArguments,
  geckodriverArguments,
  parseFirefoxVersion,
  parseGeckodriverVersion,
} from './browser-support.mjs'

const execFile = promisify(execFileCallback)
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.resolve(packageRoot, 'dist')
const sourceDir = path.resolve(outputRoot, 'firefox')
const manifestPath = path.resolve(sourceDir, 'manifest.json')
const buildManifestPath = path.resolve(sourceDir, 'build-manifest.json')
const firefoxBinary = process.env.FIREFOX_EXECUTABLE_PATH || firefox.executablePath()

async function findExecutable(name) {
  if (name.includes(path.sep)) {
    return name
  }
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (directory) {
      const candidate = path.join(directory, name)
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch {
        // Keep looking through PATH.
      }
    }
  }
  return name
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (!address || typeof address === 'string') {
    throw new Error('无法分配 geckodriver 测试端口')
  }
  return address.port
}

async function waitForWebDriver(port, driver, output) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (driver.exitCode !== null) {
      throw new Error(`geckodriver 提前退出: ${output.join('')}`)
    }
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/status`)
      if (response.ok) {
        return
      }
    } catch {
      // Driver is still starting.
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50))
  }
  throw new Error(`等待 geckodriver 启动超时: ${output.join('')}`)
}

async function startWebDriver(executable) {
  const port = await reservePort()
  const output = []
  const driver = spawn(executable, geckodriverArguments(port), { stdio: ['ignore', 'pipe', 'pipe'] })
  driver.stdout.on('data', (chunk) => output.push(String(chunk)))
  driver.stderr.on('data', (chunk) => output.push(String(chunk)))
  const stop = async () => {
    if (driver.exitCode !== null) {
      return
    }
    await new Promise((resolve) => {
      const killTimer = globalThis.setTimeout(() => {
        if (driver.exitCode === null) {
          driver.kill('SIGKILL')
        }
      }, 2_000)
      driver.once('exit', () => {
        globalThis.clearTimeout(killTimer)
        resolve()
      })
      driver.kill('SIGTERM')
    })
  }
  try {
    await waitForWebDriver(port, driver, output)
  } catch (error) {
    await stop()
    throw error
  }
  return { port, stop }
}

function createWebDriverClient(port) {
  const endpoint = `http://127.0.0.1:${port}`
  return async (method, pathname, body) => {
    const response = await globalThis.fetch(`${endpoint}${pathname}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload = await response.json()
    if (!response.ok || payload.value?.error) {
      throw new Error(payload.value?.message || `WebDriver HTTP ${response.status}`)
    }
    return payload.value
  }
}

await access(manifestPath)
await access(buildManifestPath)
const buildManifest = JSON.parse(await readFile(buildManifestPath, 'utf8'))
if (buildManifest.target !== 'firefox' || buildManifest.modelDelivery !== 'remote') {
  throw new Error('Firefox load-only smoke requires a remote-model build')
}
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
        acceptInsecureCerts: true,
        'moz:firefoxOptions': {
          binary: firefoxBinary,
          args: firefoxArguments(),
        },
      },
    },
  })
  sessionId = session.sessionId
  assert.equal(session.capabilities.browserVersion, browserVersion)
  await request('POST', `/session/${sessionId}/moz/addon/install`, { path: archivePath, temporary: true })
  process.stdout.write(
    `Firefox ${browserVersion} remote extension load-only smoke passed; authenticated model download and inference were NOT tested.\n`,
  )
} finally {
  if (sessionId) {
    await request('DELETE', `/session/${sessionId}`).catch(() => {})
  }
  await driver.stop()
}
