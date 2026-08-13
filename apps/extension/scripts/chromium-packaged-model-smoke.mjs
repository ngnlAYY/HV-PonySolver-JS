import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const unpackedPath = path.join(extensionRoot, 'dist', 'chromium')
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const packagedHint = '当前版本已内置模型，无需配置模型 Key。'

function captchaHtml() {
  const answers = Array.from(
    { length: 6 },
    () => '<input name="riddleanswer[]" type="checkbox">',
  ).join('')
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

async function waitForOneOffscreenDocument(serviceWorker) {
  await assert.doesNotReject(async () => {
    await serviceWorker.evaluate(async () => {
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        const contexts = await globalThis.chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
        if (contexts.length === 1) {
          return
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 50))
      }
      throw new Error('Offscreen document was not created')
    })
  })
}

async function runInference(context, serviceWorker, pathname, browserErrors) {
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(`${pathname}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => browserErrors.push(`${pathname}: ${error.message}`))
  await page.goto(`https://hentaiverse.org/${pathname}`)
  try {
    await page.locator('#riddlesubmit[data-submit-count="1"]').waitFor({ timeout: 120_000 })
  } catch (error) {
    const panelText = (await page.locator('.ponyLog').textContent().catch(() => ''))?.trim() || 'status panel unavailable'
    const contexts = await serviceWorker.evaluate(() => globalThis.chrome.runtime.getContexts({}))
    throw new Error(
      `Packaged inference did not submit for ${pathname}; panel: ${panelText}; contexts: ${JSON.stringify(contexts)}; browser errors: ${browserErrors.join(' | ') || 'none'}`,
      { cause: error },
    )
  }
  await page.waitForFunction(() => {
    const text = globalThis.document.querySelector('.ponyLog')?.textContent ?? ''
    return text.includes('会话状态：已就绪') && !text.includes('推理失败:')
  })
  assert.equal(await page.locator('#riddlesubmit').getAttribute('data-submit-count'), '1')
  await waitForOneOffscreenDocument(serviceWorker)
  await page.close()
}

await Promise.all([
  access(path.join(unpackedPath, 'manifest.json')),
  access(path.join(unpackedPath, 'model', 'yolo26n-640.ort')),
])

const profilePath = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-packaged-chromium-profile-'))
let context
try {
  context = await chromium.launchPersistentContext(profilePath, {
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: [`--disable-extensions-except=${unpackedPath}`, `--load-extension=${unpackedPath}`],
  })
  let serviceWorker = context.serviceWorkers()[0]
  serviceWorker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 })
  const extensionId = new globalThis.URL(serviceWorker.url()).host
  assert.match(extensionId, /^[a-z]{32}$/u)

  const browserErrors = []
  const options = await context.newPage()
  options.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(`options: ${message.text()}`)
    }
  })
  options.on('pageerror', (error) => browserErrors.push(`options: ${error.message}`))
  await options.goto(`chrome-extension://${extensionId}/options.html`)
  assert.equal(await options.title(), 'HV Pony Solver 设置')
  assert.equal(await options.locator('#model-key-fieldset').evaluate((element) => element.disabled), true)
  assert.equal(await options.locator('#model-key').isDisabled(), true)
  assert.equal(await options.locator('#verify-key').isDisabled(), true)
  assert.equal(await options.locator('#clear-key').isDisabled(), true)
  assert.equal(await options.locator('#packaged-model-hint').isVisible(), true)
  assert.equal((await options.locator('#packaged-model-hint').textContent())?.trim(), packagedHint)

  await options.locator('#submit-delay').fill('0')
  await options.locator('#multi-click-delay').fill('0')
  await options.locator('button[type="submit"]').click()
  await options.locator('#status').filter({ hasText: '设置已保存' }).waitFor()

  await context.route('https://hentaiverse.org/**', async (route) => {
    const url = new globalThis.URL(route.request().url())
    if (url.pathname === '/captcha.png') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng })
      return
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: captchaHtml() })
  })

  await runInference(context, serviceWorker, 'packaged-inference-first', browserErrors)
  await serviceWorker.evaluate(async () => {
    await globalThis.chrome.offscreen.closeDocument()
  })
  await serviceWorker.evaluate(async () => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const contexts = await globalThis.chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
      if (contexts.length === 0) {
        return
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50))
    }
    throw new Error('Offscreen document was not destroyed')
  })
  await runInference(context, serviceWorker, 'packaged-inference-second', browserErrors)

  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(' | ')}`)
  process.stdout.write(
    `Chromium ${context.browser()?.version() ?? 'unknown'} packaged model loaded, inferred, tore down, and initialized again without a Key.\n`,
  )
} finally {
  await context?.close().catch(() => undefined)
  await rm(profilePath, { recursive: true, force: true })
}
