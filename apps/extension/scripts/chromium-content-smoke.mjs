import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { HISTORY_ENTRY_PREFIX, HISTORY_KEY } from '@hv-pony-solver/browser-core/persistence/answer-history-config'
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
  const submitDisabled = precheckedIndex < 0 ? ' disabled' : ''
  return `<!doctype html>
    <html><body>
      <div id="csp">
        <div id="riddlemaster">
          <form name="riddleform">
            ${answers}
            <input id="riddlesubmit" type="button" data-submit-count="0"${submitDisabled}>
          </form>
          <div id="riddleimage"><img src="/captcha.png"></div>
        </div>
      </div>
      <script>
        const answers = [...document.querySelectorAll('input[name="riddleanswer[]"]')]
        const submit = document.querySelector('#riddlesubmit')
        const updateSubmit = () => {
          const selectedCount = answers.filter((answer) => answer.checked).length
          submit.disabled = selectedCount === 0 || selectedCount >= 4
        }
        answers.forEach((answer) => answer.addEventListener('change', updateSubmit))
        submit.addEventListener('click', (event) => {
          const button = event.currentTarget
          button.dataset.submitCount = String(Number(button.dataset.submitCount || '0') + 1)
        })
      </script>
    </body></html>`
}

function bfcacheFixtureHtml() {
  return `<!doctype html>
    <html><body>
      <main id="bfcache-fixture">BFCache fixture</main>
      <script>
        globalThis.__fixtureLifecycle = { pagehide: [], pageshow: [] }
        globalThis.addEventListener('pagehide', (event) => {
          globalThis.__fixtureLifecycle.pagehide.push(event.persisted)
        })
        globalThis.addEventListener('pageshow', (event) => {
          globalThis.__fixtureLifecycle.pageshow.push(event.persisted)
        })
      </script>
    </body></html>`
}

function installCaptcha() {
  const captchaWindow = globalThis.document.createElement('div')
  captchaWindow.id = 'csp'
  const container = globalThis.document.createElement('div')
  container.id = 'riddlemaster'
  const form = globalThis.document.createElement('form')
  form.setAttribute('name', 'riddleform')
  const answers = Array.from({ length: 6 }, () => {
    const answer = globalThis.document.createElement('input')
    answer.type = 'checkbox'
    answer.name = 'riddleanswer[]'
    form.appendChild(answer)
    return answer
  })
  const submit = globalThis.document.createElement('input')
  submit.id = 'riddlesubmit'
  submit.type = 'button'
  submit.disabled = true
  submit.dataset.submitCount = '0'
  form.appendChild(submit)
  const imageContainer = globalThis.document.createElement('div')
  imageContainer.id = 'riddleimage'
  const image = globalThis.document.createElement('img')
  image.src = '/captcha.png'
  imageContainer.appendChild(image)
  container.append(form, imageContainer)
  captchaWindow.appendChild(container)
  globalThis.document.body.appendChild(captchaWindow)

  const updateSubmit = () => {
    const selectedCount = answers.filter((answer) => answer.checked).length
    submit.disabled = selectedCount === 0 || selectedCount >= 4
  }
  answers.forEach((answer) => answer.addEventListener('change', updateSubmit))
  submit.addEventListener('click', () => {
    submit.dataset.submitCount = String(Number(submit.dataset.submitCount || '0') + 1)
  })
}

await buildExtensions({ outputRoot: temporaryRoot, targets: ['chromium'], fixtureHost: true })
const context = await chromium.launchPersistentContext(profilePath, {
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  ignoreDefaultArgs: ['--disable-back-forward-cache'],
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
    const html = url.pathname === '/extension-bfcache-fixture' ? bfcacheFixtureHtml() : currentHtml
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  })
  await context.route('https://example.com/extension-bfcache-destination', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>Destination</title>',
    }),
  )

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
    ({ entryPrefix, historyKey }) =>
      new Promise((resolve) => {
        globalThis.chrome.storage.local.get(null, (items) => {
          const records = Object.entries(items)
            .filter(([key]) => key.startsWith(`${entryPrefix}main:`))
            .map(([, value]) => (typeof value === 'string' ? JSON.parse(value) : null))
          resolve(
            !Object.hasOwn(items, historyKey) &&
              records.some((record) => record?.type === 'success' && /^TS\(\d/u.test(record.answers)) &&
              records.some((record) => record?.type === 'manual' && /^TS\(\d/u.test(record.answers)),
          )
        })
      }),
    { entryPrefix: HISTORY_ENTRY_PREFIX, historyKey: HISTORY_KEY },
  )

  const excludedPage = await context.newPage()
  await excludedPage.goto('https://hentaiverse.org/equip/12345')
  await excludedPage.waitForTimeout(500)
  assert.equal(await excludedPage.locator('.ponyLog').count(), 0)

  await options.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.chrome.storage.local.set({ hvPonySolverAnswerMode: 'auto' }, resolve)
      }),
  )
  const bfcachePage = await context.newPage()
  const cdp = await context.newCDPSession(bfcachePage)
  const bfcacheDiagnostics = []
  await cdp.send('Page.enable')
  cdp.on('Page.backForwardCacheNotUsed', (event) => bfcacheDiagnostics.push(event))
  await bfcachePage.goto('https://hentaiverse.org/extension-bfcache-fixture')
  await bfcachePage.locator('#bfcache-fixture').waitFor()
  await bfcachePage.goto('https://example.com/extension-bfcache-destination')
  await bfcachePage.goBack({ waitUntil: 'commit' })
  try {
    await bfcachePage.waitForFunction(
      () =>
        globalThis.__fixtureLifecycle?.pagehide?.includes(true) === true &&
        globalThis.__fixtureLifecycle?.pageshow?.includes(true) === true,
      undefined,
      { timeout: 15_000 },
    )
  } catch (error) {
    throw new Error(
      `Chromium did not restore the content fixture from BFCache: ${JSON.stringify(bfcacheDiagnostics)}`,
      {
        cause: error,
      },
    )
  }
  await bfcachePage.evaluate(installCaptcha)
  await bfcachePage.locator('#riddlesubmit[data-submit-count="1"]').waitFor({ timeout: 15_000 })
  assert.equal(await bfcachePage.locator('.ponyLog').count(), 1)
  assert.equal(await bfcachePage.locator('input[name="riddleanswer[]"]:checked').count(), 1)
  await bfcachePage.waitForTimeout(300)
  assert.equal(await bfcachePage.locator('#riddlesubmit').getAttribute('data-submit-count'), '1')

  process.stdout.write(
    'Chromium content fixture verified automatic/manual solve, one submit, keyed history, excluded routes, and BFCache restore.\n',
  )
} finally {
  await context.close()
  await Promise.all([
    rm(temporaryRoot, { recursive: true, force: true }),
    rm(profilePath, { recursive: true, force: true }),
  ])
}
