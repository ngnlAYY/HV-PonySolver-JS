import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { firefox } from '@playwright/test'

const execFileAsync = promisify(execFile)
const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(path.join(extensionRoot, 'package.json'), 'utf8'))
const archivePath = path.join(extensionRoot, 'dist', `hv-pony-solver-firefox-packaged-${packageJson.version}.zip`)
const firefoxExecutable = process.env.FIREFOX_EXECUTABLE_PATH || firefox.executablePath()
const packagedHint = '当前版本已内置模型，无需配置模型 Key。'
const addonId = 'hv-pony-solver@ngnl.host'
const extensionUuid = '11111111-2222-4333-8444-555555555555'
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

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

function captchaHtml() {
  const answers = '<input name="riddleanswer[]" type="checkbox">'.repeat(6)
  return `<!doctype html>
    <html><body>
      <div id="riddlemaster">
        <form name="riddleform">
          ${answers}
          <input id="riddlesubmit" type="button" data-submit-count="0">
        </form>
        <div id="riddleimage"><img src="/captcha.png"></div>
      </div>
      <script>
        document.querySelector('#riddlesubmit').addEventListener('click', (event) => {
          const button = event.currentTarget
          button.dataset.submitCount = String(Number(button.dataset.submitCount || '0') + 1)
        })
      </script>
    </body></html>`
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('无法分配 Firefox 测试端口')
  }
  return address.port
}

async function closeServer(server) {
  if (!server.listening) {
    return
  }
  await new Promise((resolve) => server.close(resolve))
}

async function startFixtureProxy(temporaryRoot) {
  const keyPath = path.join(temporaryRoot, 'fixture-key.pem')
  const certificatePath = path.join(temporaryRoot, 'fixture-cert.pem')
  await execFileAsync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath,
    '-out', certificatePath,
    '-days', '1',
    '-subj', '/CN=hentaiverse.org',
    '-addext', 'subjectAltName=DNS:hentaiverse.org',
  ])
  const secureContext = tls.createSecureContext({
    key: await readFile(keyPath),
    cert: await readFile(certificatePath),
  })
  const html = Buffer.from(captchaHtml())
  const server = http.createServer((_request, response) => {
    response.writeHead(502)
    response.end()
  })
  server.on('connect', (_request, client, head) => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    const secureSocket = new tls.TLSSocket(client, { isServer: true, secureContext })
    secureSocket.once('data', (requestBytes) => {
      const firstLine = requestBytes.toString('latin1').split('\r\n')[0] ?? ''
      const requestPath = firstLine.split(' ')[1] ?? '/'
      const servesImage = requestPath.startsWith('/captcha.png')
      const body = servesImage ? transparentPng : html
      const contentType = servesImage ? 'image/png' : 'text/html; charset=utf-8'
      secureSocket.end(
        Buffer.concat([
          Buffer.from(
            `HTTP/1.1 200 OK\r\nContent-Type: ${contentType}\r\nContent-Length: ${body.byteLength}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n`,
          ),
          body,
        ]),
      )
    })
    secureSocket.on('error', () => client.destroy())
    if (head.byteLength > 0) {
      secureSocket.unshift(head)
    }
  })
  const port = await listen(server)
  return { port, stop: () => closeServer(server) }
}

async function reservePort() {
  const server = net.createServer()
  const port = await listen(server)
  await closeServer(server)
  return port
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
  const driver = spawn(executable, ['--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
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
  return {
    port,
    stop,
  }
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

async function runInstalledArtifact(request, proxyPort, runIndex) {
  const session = await request('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        acceptInsecureCerts: true,
        proxy: {
          proxyType: 'manual',
          httpProxy: `127.0.0.1:${proxyPort}`,
          sslProxy: `127.0.0.1:${proxyPort}`,
          noProxy: [],
        },
        'moz:firefoxOptions': {
          binary: firefoxExecutable,
          args: ['-headless', '-remote-allow-system-access'],
          prefs: {
            'extensions.webextensions.uuids': JSON.stringify({ [addonId]: extensionUuid }),
          },
        },
      },
    },
  })
  const sessionId = session.sessionId
  const sessionPath = `/session/${sessionId}`
  try {
    await request('POST', `${sessionPath}/moz/addon/install`, { path: archivePath, temporary: true })
    await request('POST', `${sessionPath}/timeouts`, { script: 150_000, pageLoad: 60_000 })
    await request('POST', `${sessionPath}/moz/context`, { context: 'chrome' })
    await request('POST', `${sessionPath}/execute/async`, {
      script: `
        const done = arguments[arguments.length - 1]
        ;(async () => {
          const uri = 'moz-extension://${extensionUuid}/options.html'
          const window = Services.wm.getMostRecentWindow('navigator:browser')
          const tab = window.gBrowser.addTab(uri, {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          })
          window.gBrowser.selectedTab = tab
          await new Promise((resolve) => setTimeout(resolve, 500))
          done()
        })().catch((error) => done({ error: String(error) }))
      `,
      args: [],
    })
    await request('POST', `${sessionPath}/moz/context`, { context: 'content' })
    const handles = await request('GET', `${sessionPath}/window/handles`)
    await request('POST', `${sessionPath}/window`, { handle: handles.at(-1) })
    const optionsState = await request('POST', `${sessionPath}/execute/sync`, {
      script: `
        return {
          title: document.title,
          disabled: document.querySelector('#model-key-fieldset')?.disabled,
          inputDisabled: document.querySelector('#model-key')?.matches(':disabled'),
          hintHidden: document.querySelector('#packaged-model-hint')?.hidden,
          hint: document.querySelector('#packaged-model-hint')?.textContent?.trim(),
        }
      `,
      args: [],
    })
    assert.deepEqual(optionsState, {
      title: 'HV Pony Solver 设置',
      disabled: true,
      inputDisabled: true,
      hintHidden: false,
      hint: packagedHint,
    })
    const storageResult = await request('POST', `${sessionPath}/execute/async`, {
      script: `
        const done = arguments[arguments.length - 1]
        browser.storage.local.set({
          hvPonySolverSubmitDelay: '0',
          hvPonySolverMultiClickDelay: '0',
          hvPonySolverAnswerMode: 'auto',
        }).then(() => done({ ok: true }), (error) => done({ error: String(error) }))
      `,
      args: [],
    })
    assert.deepEqual(storageResult, { ok: true })
    await request('POST', `${sessionPath}/url`, { url: `https://hentaiverse.org/fixture?run=${runIndex}` })
    const inferenceResult = await request('POST', `${sessionPath}/execute/async`, {
      script: `
        const done = arguments[arguments.length - 1]
        const deadline = Date.now() + 120_000
        const poll = () => {
          const count = document.querySelector('#riddlesubmit')?.dataset.submitCount
          const panel = document.querySelector('.ponyLog')?.textContent || ''
          if (count === '1') {
            done({
              ok: true,
              count,
              checked: document.querySelectorAll('input[name="riddleanswer[]"]:checked').length,
              panel,
            })
            return
          }
          if (panel.includes('会话状态：错误') || panel.includes('推理失败:')) {
            done({ ok: false, count, panel })
            return
          }
          if (Date.now() > deadline) {
            done({ ok: false, count, panel, timeout: true })
            return
          }
          setTimeout(poll, 100)
        }
        poll()
      `,
      args: [],
    })
    assert.equal(inferenceResult.ok, true, JSON.stringify(inferenceResult))
    assert.equal(inferenceResult.count, '1')
    assert.equal(inferenceResult.checked, 1)
    assert.match(inferenceResult.panel, /会话状态：已就绪/u)
    return session.capabilities.browserVersion
  } finally {
    await request('DELETE', sessionPath).catch(() => undefined)
  }
}

await Promise.all([access(archivePath), access(firefoxExecutable)])
const geckodriverExecutable = await findExecutable(process.env.GECKODRIVER_PATH || 'geckodriver')
try {
  await access(geckodriverExecutable, constants.X_OK)
} catch {
  throw new Error('geckodriver 不可用；请安装它或设置 GECKODRIVER_PATH')
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-packaged-firefox-'))
let proxy
let driver
try {
  proxy = await startFixtureProxy(temporaryRoot)
  driver = await startWebDriver(geckodriverExecutable)
  const request = createWebDriverClient(driver.port)
  const firstVersion = await runInstalledArtifact(request, proxy.port, 1)
  const secondVersion = await runInstalledArtifact(request, proxy.port, 2)
  assert.equal(secondVersion, firstVersion)
  process.stdout.write(
    `Firefox ${firstVersion} packaged ZIP loaded, inferred, tore down, and initialized again without a Key.\n`,
  )
} finally {
  await driver?.stop().catch(() => undefined)
  await proxy?.stop().catch(() => undefined)
  await rm(temporaryRoot, { recursive: true, force: true })
}
