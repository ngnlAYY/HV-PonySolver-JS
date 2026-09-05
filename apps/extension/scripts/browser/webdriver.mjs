import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { geckodriverArguments } from '../browser-support.mjs'

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

async function waitForWebDriver(port, driver, output, startupError) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (startupError()) throw startupError()
    if (driver.exitCode !== null || driver.signalCode !== null) {
      throw new Error(`geckodriver 提前退出: ${output()}`)
    }
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/status`, {
        signal: globalThis.AbortSignal.timeout(Math.max(1, Math.min(1_000, deadline - Date.now()))),
      })
      void response.body?.cancel().catch(() => undefined)
      if (response.ok) {
        return
      }
    } catch {
      // Driver is still starting.
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50))
  }
  throw new Error(`等待 geckodriver 启动超时: ${output()}`)
}

async function startWebDriver(executable) {
  const port = await reservePort()
  let output = ''
  let startupError
  const recordOutput = (chunk) => {
    output = (output + String(chunk)).slice(-64 * 1024)
  }
  const driver = spawn(executable, geckodriverArguments(port), { stdio: ['ignore', 'pipe', 'pipe'] })
  driver.stdout.on('data', recordOutput)
  driver.stderr.on('data', recordOutput)
  driver.once('error', (error) => {
    startupError = error
  })
  const stop = async () => {
    if (driver.exitCode !== null || driver.signalCode !== null || !driver.pid) {
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
    await waitForWebDriver(
      port,
      driver,
      () => output,
      () => startupError,
    )
  } catch (error) {
    await stop()
    throw error
  }
  return { port, stop }
}

function createWebDriverClient(port, { timeoutMs = 180_000 } = {}) {
  const endpoint = `http://127.0.0.1:${port}`
  return async (method, pathname, body) => {
    const response = await globalThis.fetch(`${endpoint}${pathname}`, {
      method,
      signal: globalThis.AbortSignal.timeout(timeoutMs),
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

export { findExecutable, startWebDriver, createWebDriverClient }
