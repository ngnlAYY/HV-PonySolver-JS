import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { chromium } from '@playwright/test'

import { buildExtensions } from './build-extension.mjs'

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-extension-fixture-'))
const profilePath = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-extension-fixture-profile-'))
const unpackedPath = path.join(temporaryRoot, 'chromium')
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function captchaHtml({ precheckedIndex = -1 } = {}) {
  const answers = Array.from(
    { length: 6 },
    (_, index) => `<input name="riddleanswer[]" type="checkbox"${index === precheckedIndex ? ' checked' : ''}>`,
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

await buildExtensions({ outputRoot: temporaryRoot, targets: ['chromium'], fixtureHost: true })
const context = await chromium.launchPersistentContext(profilePath, {
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: [`--disable-extensions-except=${unpackedPath}`, `--load-extension=${unpackedPath}`],
})

try {
  let serviceWorker = context.serviceWorkers()[0]
  serviceWorker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 })
  const extensionId = new globalThis.URL(serviceWorker.url()).host
  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html`)
  await options.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.chrome.storage.local.set(
          {
            hvPonySolverSubmitDelay: '0',
            hvPonySolverMultiClickDelay: '0',
            hvPonySolverAnswerMode: 'auto',
          },
          resolve,
        )
      }),
  )

  let currentHtml = captchaHtml()
  await context.route('https://hentaiverse.org/**', async (route) => {
    const url = new globalThis.URL(route.request().url())
    if (url.pathname === '/captcha.png') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng })
      return
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: currentHtml })
  })

  const automaticPage = await context.newPage()
  await automaticPage.goto('https://hentaiverse.org/extension-auto-fixture')
  await automaticPage.locator('#riddlesubmit[data-submit-count="1"]').waitFor({ timeout: 15_000 })
  assert.equal(await automaticPage.locator('input[name="riddleanswer[]"]').nth(0).isChecked(), true)
  assert.equal(await automaticPage.locator('input[name="riddleanswer[]"]:checked').count(), 1)
  await automaticPage.waitForTimeout(300)
  assert.equal(await automaticPage.locator('#riddlesubmit').getAttribute('data-submit-count'), '1')
  await automaticPage.locator('.ponyLog').filter({ hasText: 'TS' }).waitFor()

  await options.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.chrome.storage.local.set({ hvPonySolverAnswerMode: 'manual' }, resolve)
      }),
  )
  currentHtml = captchaHtml({ precheckedIndex: 2 })
  const manualPage = await context.newPage()
  await manualPage.goto('https://hentaiverse.org/extension-manual-fixture')
  await manualPage.locator('.ponyLog').filter({ hasText: '手动' }).waitFor({ timeout: 15_000 })
  assert.equal(await manualPage.locator('#riddlesubmit').getAttribute('data-submit-count'), '0')
  assert.equal(await manualPage.locator('input[name="riddleanswer[]"]').nth(2).isChecked(), true)

  await options.waitForFunction(
    () =>
      new Promise((resolve) => {
        globalThis.chrome.storage.local.get('hvPonySolverHistory', (items) => {
          const history = typeof items.hvPonySolverHistory === 'string' ? JSON.parse(items.hvPonySolverHistory) : {}
          resolve(Array.isArray(history.main) && history.main.length >= 2)
        })
      }),
  )

  const excludedPage = await context.newPage()
  await excludedPage.goto('https://hentaiverse.org/equip/12345')
  await excludedPage.waitForTimeout(500)
  assert.equal(await excludedPage.locator('.ponyLog').count(), 0)

  process.stdout.write('Chromium content fixture verified automatic/manual solve, one submit, history, and excluded routes.\n')
} finally {
  await context.close()
  await Promise.all([
    rm(temporaryRoot, { recursive: true, force: true }),
    rm(profilePath, { recursive: true, force: true }),
  ])
}
