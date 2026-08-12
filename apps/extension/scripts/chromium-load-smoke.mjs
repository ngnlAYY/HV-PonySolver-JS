import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const unpackedPath = path.join(extensionRoot, 'dist', 'chromium')
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
const productionKey = process.env.KvKey?.trim() ?? ''
const profilePath = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-extension-profile-'))

await access(path.join(unpackedPath, 'manifest.json'))

const context = await chromium.launchPersistentContext(profilePath, {
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: [`--disable-extensions-except=${unpackedPath}`, `--load-extension=${unpackedPath}`],
})

try {
  let serviceWorker = context.serviceWorkers()[0]
  serviceWorker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 })
  const extensionId = new globalThis.URL(serviceWorker.url()).host
  assert.match(extensionId, /^[a-z]{32}$/)

  const page = await context.newPage()
  const browserErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.goto(`chrome-extension://${extensionId}/options.html`)
  assert.equal(await page.title(), 'HV Pony Solver 设置')
  await page.locator('#submit-delay').fill('2400-2600')
  await page.locator('#multi-click-delay').fill('600')
  await page.locator('button[type="submit"]').click()
  await page.locator('#status').filter({ hasText: '设置已保存' }).waitFor()

  const saved = await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.chrome.storage.local.get(null, resolve)
      }),
  )
  assert.equal(saved.hvPonySolverSubmitDelay, '2400-2600')
  assert.equal(saved.hvPonySolverMultiClickDelay, '600')

  if (productionKey) {
    await page.locator('#model-key').fill(productionKey)
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
    const contexts = await page.evaluate(() => globalThis.chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }))
    assert.equal(contexts.length, 1)
  }

  process.stdout.write(productionKey ? 'Chromium extension loaded; production model and packaged inference runtime verified.\n' : 'Chromium extension loaded and settings storage verified.\n')
} finally {
  await context.close()
  await rm(profilePath, { recursive: true, force: true })
}
