import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from '@playwright/test'

import { assertBrowserVersionForRun } from './browser-support.mjs'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

export function resolveRemoteSmokeMode(args, environment = process.env) {
  if (!Array.isArray(args) || args.length !== 1 || !['--load-only', '--authenticated'].includes(args[0])) {
    throw new Error('Usage: chromium-load-smoke.mjs --load-only|--authenticated')
  }
  if (args[0] === '--load-only') {
    return { mode: 'load-only' }
  }
  const key = environment.KvKey?.trim() ?? ''
  if (!key) {
    throw new Error('KvKey is required for the authenticated remote inference smoke')
  }
  return { mode: 'authenticated', key }
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

async function runAuthenticatedDetect(context, browserErrors) {
  await context.route('https://hentaiverse.org/**', async (route) => {
    const url = new globalThis.URL(route.request().url())
    if (url.pathname === '/captcha.png') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng })
      return
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: captchaHtml() })
  })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(`detect: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => browserErrors.push(`detect: ${error.message}`))
  await page.goto('https://hentaiverse.org/remote-authenticated-detect')
  try {
    await page.waitForFunction(
      () => {
        const panel = globalThis.document.querySelector('.ponyLog')?.textContent ?? ''
        return (
          /\[[A-Z]{2}\(\d+(?:\.\d+)?\)\]/u.test(panel) ||
          panel.includes('识别失败: 无可提交答案') ||
          panel.includes('推理失败:')
        )
      },
      undefined,
      { timeout: 120_000 },
    )
  } catch (error) {
    const panel =
      (
        await page
          .locator('.ponyLog')
          .textContent()
          .catch(() => '')
      )?.trim() || 'status panel unavailable'
    throw new Error(`Authenticated remote detect did not settle; panel: ${panel}`, { cause: error })
  }
  const result = await page.evaluate(() => ({
    checkedIndexes: Array.from(globalThis.document.querySelectorAll('input[name="riddleanswer[]"]'), (input, index) =>
      input.checked ? index : -1,
    ).filter((index) => index >= 0),
    panel: globalThis.document.querySelector('.ponyLog')?.textContent ?? '',
    submitCount: globalThis.document.querySelector('#riddlesubmit')?.dataset.submitCount ?? '',
  }))
  assert.doesNotMatch(result.panel, /推理失败:|识别失败，随机选择/u)
  if (/\[[A-Z]{2}\(\d+(?:\.\d+)?\)\]/u.test(result.panel)) {
    assert.equal(result.submitCount, '1')
    assert.ok(result.checkedIndexes.length > 0)
    await page.close()
    return 'success'
  }
  assert.match(result.panel, /识别失败: 无可提交答案/u)
  assert.equal(result.submitCount, '0')
  assert.deepEqual(result.checkedIndexes, [])
  await page.close()
  return 'no-detection'
}

export async function runRemoteChromiumSmoke(args = process.argv.slice(2), environment = process.env) {
  const policy = resolveRemoteSmokeMode(args, environment)
  const unpackedPath = path.join(extensionRoot, 'dist', 'chromium')
  const executablePath =
    environment.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
  const profilePath = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-extension-profile-'))

  await access(path.join(unpackedPath, 'manifest.json'))
  const buildManifest = JSON.parse(await readFile(path.join(unpackedPath, 'build-manifest.json'), 'utf8'))
  if (buildManifest.target !== 'chromium' || buildManifest.modelDelivery !== 'remote') {
    throw new Error('Chromium remote smoke requires a Chromium remote-model build')
  }

  let context
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      args: [`--disable-extensions-except=${unpackedPath}`, `--load-extension=${unpackedPath}`],
    })
    const browserVersion = context.browser()?.version() ?? ''
    assertBrowserVersionForRun('chromium', browserVersion, environment)
    let serviceWorker = context.serviceWorkers()[0]
    serviceWorker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 })
    const extensionId = new globalThis.URL(serviceWorker.url()).host
    assert.match(extensionId, /^[a-z]{32}$/u)

    const page = await context.newPage()
    const browserErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        browserErrors.push(`options: ${message.text()}`)
      }
    })
    page.on('pageerror', (error) => browserErrors.push(`options: ${error.message}`))
    await page.goto(`chrome-extension://${extensionId}/options.html`)
    assert.equal(await page.title(), 'HV Pony Solver 设置')
    await page.locator('#answer-mode').selectOption('auto')
    await page.locator('#submit-delay').fill('0')
    await page.locator('#multi-click-delay').fill('0')
    await page.locator('#random-on-fail').uncheck()
    await page.locator('button[type="submit"]').click()
    await page.locator('#status').filter({ hasText: '设置已保存' }).waitFor()

    const saved = await page.evaluate(
      () =>
        new Promise((resolve) => {
          globalThis.chrome.storage.local.get(null, resolve)
        }),
    )
    assert.equal(saved.hvPonySolverSubmitDelay, '0')
    assert.equal(saved.hvPonySolverMultiClickDelay, '0')
    assert.equal(saved.hvPonySolverRandomOnFail, '0')

    if (policy.mode === 'load-only') {
      assert.deepEqual(browserErrors, [])
      process.stdout.write(
        `Chromium ${browserVersion} remote extension load-only smoke passed; authenticated model download and inference were NOT tested.\n`,
      )
      return { browserVersion, mode: policy.mode }
    }

    await page.locator('#model-key').fill(policy.key)
    await page.locator('#verify-key').click()
    await page.waitForFunction(
      () => {
        const text = globalThis.document.querySelector('#status')?.textContent ?? ''
        return text.length > 0 && text !== '正在下载并校验模型…'
      },
      undefined,
      { timeout: 120_000 },
    )
    const verificationStatus = await page.locator('#status').textContent()
    assert.equal(
      verificationStatus,
      '模型 Key 验证成功并已安全保存',
      `Production verification failed: ${verificationStatus || 'empty status'}${browserErrors.length > 0 ? `; browser errors: ${browserErrors.join(' | ')}` : ''}`,
    )
    const contexts = await page.evaluate(() =>
      globalThis.chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }),
    )
    assert.equal(contexts.length, 1)
    const detectResult = await runAuthenticatedDetect(context, browserErrors)
    assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(' | ')}`)
    process.stdout.write(
      `Chromium ${browserVersion} authenticated remote smoke downloaded and verified the model, then completed a detect request (${detectResult}) with random fallback disabled.\n`,
    )
    return { browserVersion, detectResult, mode: policy.mode }
  } finally {
    await context?.close().catch(() => undefined)
    await rm(profilePath, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  await runRemoteChromiumSmoke()
}
