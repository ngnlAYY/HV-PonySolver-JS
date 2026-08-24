import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { assertBrowserVersionForRun, resolvePackagedChromiumHeadless } from './browser-support.mjs'
import { validatePackagedInferenceObservation, writePackagedE2eEvidence } from './packaged-e2e-evidence.mjs'
import {
  discoverPackagedArtifact,
  extractAndVerifyPackagedArchive,
  verifyExtractedPackagedTree,
} from './packaged-smoke-artifact.mjs'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = path.resolve(process.env.PACKAGED_EXTENSION_OUTPUT_ROOT || path.join(extensionRoot, 'dist'))
const evidenceDirectory = path.resolve(
  process.env.PACKAGED_E2E_EVIDENCE_DIR || path.join(outputRoot, 'packaged-e2e-evidence'),
)
const packagedArtifact = await discoverPackagedArtifact(outputRoot, 'chromium')
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const packagedHint = '当前版本已内置模型，无需配置模型 Key。'

function captchaHtml() {
  const answers = Array.from({ length: 6 }, () => '<input name="riddleanswer[]" type="checkbox">').join('')
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

async function waitForOffscreenDocumentCount(extensionPage, expectedCount, timeoutMs, failureMessage) {
  await assert.doesNotReject(
    () =>
      extensionPage.evaluate(
        async ({ expectedCount: expected, timeout }) => {
          const deadline = Date.now() + timeout
          while (Date.now() < deadline) {
            const contexts = await globalThis.chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
            if (contexts.length === expected) {
              return
            }
            await new Promise((resolve) => globalThis.setTimeout(resolve, 50))
          }
          throw new Error(`Expected ${expected} Offscreen document(s)`)
        },
        { expectedCount, timeout: timeoutMs },
      ),
    failureMessage,
  )
}

async function getExtensionTargets(cdp, extensionId) {
  const { targetInfos } = await cdp.send('Target.getTargets')
  return targetInfos.filter((target) => {
    try {
      return new globalThis.URL(target.url).host === extensionId
    } catch {
      return false
    }
  })
}

function waitForTargetEvent(cdp, eventName, predicate, timeoutMs, failureMessage) {
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      if (!predicate(event)) {
        return
      }
      globalThis.clearTimeout(timeoutId)
      cdp.off(eventName, listener)
      resolve(event)
    }
    const timeoutId = globalThis.setTimeout(() => {
      cdp.off(eventName, listener)
      reject(new Error(failureMessage))
    }, timeoutMs)
    cdp.on(eventName, listener)
  })
}

/**
 * Dedicated workers of an Offscreen document are not listed by browser-level
 * Target.getTargets. Attach through the Offscreen target once to learn the
 * inference Worker's target ID, then cancel the auto-attach and detach so the
 * Worker keeps normal termination semantics (no debugger may hold it).
 */
async function discoverInferenceWorkerTarget(cdp, extensionId, offscreenTargetId) {
  const attachedPromise = waitForTargetEvent(
    cdp,
    'Target.attachedToTarget',
    (event) =>
      event.targetInfo.type === 'worker' &&
      event.targetInfo.url === `chrome-extension://${extensionId}/inference-worker.js`,
    15_000,
    'Inference Worker target not found through the Offscreen Host',
  )
  await cdp.send('Target.autoAttachRelated', {
    targetId: offscreenTargetId,
    waitForDebuggerOnStart: false,
    filter: [{ type: 'worker' }],
  })
  const { sessionId, targetInfo } = await attachedPromise
  await cdp.send('Target.setAutoAttach', {
    autoAttach: false,
    waitForDebuggerOnStart: false,
    flatten: true,
  })
  // setAutoAttach(false) already detaches the auto-attached session.
  await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
  return targetInfo.targetId
}

async function waitForTargetGone(cdp, targetId, timeoutMs, failureMessage) {
  let lastTargetInfo
  try {
    ;({ targetInfo: lastTargetInfo } = await cdp.send('Target.getTargetInfo', { targetId }))
  } catch (error) {
    throw new Error(`Unable to observe the old inference Worker before restart: ${targetId}`, { cause: error })
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      ;({ targetInfo: lastTargetInfo } = await cdp.send('Target.getTargetInfo', { targetId }))
    } catch {
      return
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50))
  }
  throw new Error(`${failureMessage}: ${JSON.stringify(lastTargetInfo)}`)
}

async function findRunningServiceWorkerVersion(cdp, scriptUrl) {
  const versionPromise = waitForTargetEvent(
    cdp,
    'ServiceWorker.workerVersionUpdated',
    ({ versions }) =>
      versions.some((version) => version.scriptURL === scriptUrl && version.runningStatus === 'running'),
    15_000,
    `Running service worker version not found: ${scriptUrl}`,
  )
  await cdp.send('ServiceWorker.enable')
  const { versions } = await versionPromise
  return versions.find((version) => version.scriptURL === scriptUrl && version.runningStatus === 'running')
}

async function runInference(context, extensionPage, pathname, browserErrors, beforeCompletion, randomFallbackDisabled) {
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(`${pathname}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => browserErrors.push(`${pathname}: ${error.message}`))
  await page.goto(`https://hentaiverse.org/${pathname}`)
  try {
    await beforeCompletion?.(page)
    await page.locator('#riddlesubmit[data-submit-count="1"]').waitFor({ timeout: 120_000 })
    await page.waitForFunction(() => {
      const text = globalThis.document.querySelector('.ponyLog')?.textContent ?? ''
      return (
        /\[[A-Z]{2}\(\d+(?:\.\d+)?\)\]/u.test(text) || text.includes('识别失败，随机选择') || text.includes('推理失败:')
      )
    })
  } catch (error) {
    const panelText =
      (
        await page
          .locator('.ponyLog')
          .textContent()
          .catch(() => '')
      )?.trim() || 'status panel unavailable'
    const contexts = await extensionPage.evaluate(() => globalThis.chrome.runtime.getContexts({}))
    throw new Error(
      `Packaged inference did not produce a submitted result for ${pathname}; panel: ${panelText}; contexts: ${JSON.stringify(contexts)}; browser errors: ${browserErrors.join(' | ') || 'none'}`,
      { cause: error },
    )
  }
  const observation = await page.evaluate(
    (fallbackDisabled) => ({
      checkedIndexes: Array.from(
        globalThis.document.querySelectorAll('input[name="riddleanswer[]"]'),
        (input, index) => (input.checked ? index : -1),
      ).filter((index) => index >= 0),
      panel: globalThis.document.querySelector('.ponyLog')?.textContent ?? '',
      randomFallbackDisabled: fallbackDisabled,
    }),
    randomFallbackDisabled,
  )
  validatePackagedInferenceObservation(observation, packagedArtifact.oracle, pathname)
  assert.equal(await page.locator('#riddlesubmit').getAttribute('data-submit-count'), '1')
  await waitForOffscreenDocumentCount(extensionPage, 1, 15_000, 'Offscreen document was not created')
  await page.close()
  return observation
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'hv-pony-packaged-chromium-'))
const profilePath = path.join(temporaryRoot, 'profile')
const unpackedPath = path.join(temporaryRoot, 'tested-archive')
let context
try {
  const archiveVerification = await extractAndVerifyPackagedArchive(packagedArtifact, unpackedPath)
  context = await chromium.launchPersistentContext(profilePath, {
    ...(executablePath ? { executablePath } : {}),
    headless: resolvePackagedChromiumHeadless(),
    args: [`--disable-extensions-except=${unpackedPath}`, `--load-extension=${unpackedPath}`],
  })
  const browserVersion = context.browser()?.version() ?? ''
  assertBrowserVersionForRun('chromium', browserVersion)
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }))
  const extensionId = new globalThis.URL(serviceWorker.url()).host
  const serviceWorkerScriptUrl = serviceWorker.url()
  assert.match(extensionId, /^[a-z]{32}$/u)
  const cdp = await context.browser().newBrowserCDPSession()
  await cdp.send('Target.setDiscoverTargets', { discover: true })

  const browserErrors = []
  const options = await context.newPage()
  options.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(`options: ${message.text()}`)
    }
  })
  options.on('pageerror', (error) => browserErrors.push(`options: ${error.message}`))
  await options.goto(`chrome-extension://${extensionId}/options.html`)
  const serviceWorkerCdp = await context.newCDPSession(options)
  assert.equal(await options.title(), 'HV Pony Solver 设置')
  assert.equal(await options.locator('#model-key-fieldset').evaluate((element) => element.disabled), true)
  assert.equal(await options.locator('#model-key').isDisabled(), true)
  assert.equal(await options.locator('#verify-key').isDisabled(), true)
  assert.equal(await options.locator('#clear-key').isDisabled(), true)
  assert.equal(await options.locator('#packaged-model-hint').isVisible(), true)
  assert.equal((await options.locator('#packaged-model-hint').textContent())?.trim(), packagedHint)

  await options.locator('#answer-mode').selectOption('auto')
  await options.locator('#submit-delay').fill('0')
  await options.locator('#multi-click-delay').fill('0')
  await options.locator('#random-on-fail').uncheck()
  assert.equal(await options.locator('#random-on-fail').isChecked(), false)
  await options.locator('button[type="submit"]').click()
  await options.locator('#status').filter({ hasText: '设置已保存' }).waitFor()
  const savedFallback = await options.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.chrome.storage.local.get('hvPonySolverRandomOnFail', (values) => {
          resolve(values.hvPonySolverRandomOnFail)
        })
      }),
  )
  assert.equal(savedFallback, '0')
  const randomFallbackDisabled = savedFallback === '0'

  await context.route('https://hentaiverse.org/**', async (route) => {
    const url = new globalThis.URL(route.request().url())
    if (url.pathname === '/captcha.png') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng })
      return
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: captchaHtml() })
  })

  const fixtureArtifact = packagedArtifact.artifact.fixture === true
  const observations = []
  observations.push(
    await runInference(context, options, 'packaged-inference-first', browserErrors, undefined, randomFallbackDisabled),
  )

  // The mid-inference service-worker restart is only deterministic when the
  // artifact embeds the fixture detect delay: the five-second beforeDetect
  // window holds the request in-flight while the old service worker stops.
  // Canonical packages detect too fast to guarantee an in-flight window, so
  // they verify first inference, warm-idle close, and recreation only.
  if (fixtureArtifact) {
    const targetsBeforeRestart = await getExtensionTargets(cdp, extensionId)
    const offscreenBeforeRestart = targetsBeforeRestart.find(
      (target) =>
        target.type === 'background_page' && target.url === `chrome-extension://${extensionId}/offscreen.html`,
    )
    assert.ok(offscreenBeforeRestart, `Offscreen target not found: ${JSON.stringify(targetsBeforeRestart)}`)
    const oldInferenceWorkerTargetId = await discoverInferenceWorkerTarget(
      cdp,
      extensionId,
      offscreenBeforeRestart.targetId,
    )
    const oldServiceWorkerVersion = await findRunningServiceWorkerVersion(serviceWorkerCdp, serviceWorkerScriptUrl)

    // The content-owned status row flips to 推理请求中 right before detect is
    // dispatched; the fixture's five-second beforeDetect window then holds the
    // request in-flight while the old service worker is stopped.
    observations.push(
      await runInference(
        context,
        options,
        'packaged-inference-after-service-worker-restart',
        browserErrors,
        async (page) => {
          await page.waitForFunction(() =>
            globalThis.document.querySelector('.ponyLog')?.textContent?.includes('推理请求中'),
          )
          await new Promise((resolve) => globalThis.setTimeout(resolve, 600))
          await serviceWorkerCdp.send('ServiceWorker.stopWorker', { versionId: oldServiceWorkerVersion.versionId })
          // Chromium may reuse the DevTools target for the restarted worker, so
          // the restart is proven by its effect instead: the replacement's epoch
          // claim cancels the orphaned detect and terminates its inference Worker.
          await waitForTargetGone(
            cdp,
            oldInferenceWorkerTargetId,
            15_000,
            'Old-epoch inference Worker was not destroyed after service-worker restart',
          )
          await waitForOffscreenDocumentCount(options, 1, 15_000, 'Offscreen document was lost during restart')
          const targetsAfterRestart = await getExtensionTargets(cdp, extensionId)
          const offscreensAfterRestart = targetsAfterRestart.filter(
            (target) =>
              target.type === 'background_page' && target.url === `chrome-extension://${extensionId}/offscreen.html`,
          )
          assert.equal(offscreensAfterRestart.length, 1)
          assert.equal(offscreensAfterRestart[0].targetId, offscreenBeforeRestart.targetId)
        },
        randomFallbackDisabled,
      ),
    )
    assert.deepEqual(browserErrors, [], `Browser errors after restart: ${browserErrors.join(' | ')}`)
  }

  await waitForOffscreenDocumentCount(options, 0, 45_000, 'Offscreen document did not close after warm-idle timeout')
  observations.push(
    await runInference(
      context,
      options,
      'packaged-inference-after-idle-recreation',
      browserErrors,
      undefined,
      randomFallbackDisabled,
    ),
  )

  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join(' | ')}`)
  await verifyExtractedPackagedTree(unpackedPath, archiveVerification)
  await writePackagedE2eEvidence(evidenceDirectory, {
    target: 'chromium',
    packagedArtifact,
    archiveVerification,
    browserVersion,
    observations,
  })
  const inferenceClaim = packagedArtifact.oracle
    ? 'matched the fixture inference oracle across restart and idle recreation'
    : `completed ${observations.length} successful non-random inference runs across idle recreation`
  const lifecycleClaim = fixtureArtifact
    ? 'preserved one Offscreen Host across a service-worker restart, cancelled old-epoch work, closed it after warm idle, and recreated it without a Key or random fallback'
    : 'closed the Offscreen Host after warm idle and recreated it without a Key or random fallback'
  process.stdout.write(
    `Chromium ${browserVersion} loaded the verified packaged ZIP, ${inferenceClaim}, ${lifecycleClaim}.\n`,
  )
} finally {
  await context?.close().catch(() => undefined)
  await rm(temporaryRoot, { recursive: true, force: true })
}
