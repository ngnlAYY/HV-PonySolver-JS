import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HISTORY_ENTRY_PREFIX,
  HISTORY_KEY,
  HISTORY_MAX,
} from '@hv-pony-solver/browser-core/persistence/answer-history-config'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(dirname, '../..')
const repoRoot = path.resolve(appRoot, '../..')

const localPageUrl = 'http://pony-solver-e2e.local/riddle'
const localCaptchaUrl = 'http://pony-solver-e2e.local/captcha.png'

async function buildBrowserBundle(): Promise<string> {
  const browserBundle = await build({
    absWorkingDir: appRoot,
    bundle: true,
    format: 'iife',
    globalName: 'HvPonySolverE2E',
    platform: 'browser',
    write: false,
    stdin: {
      contents: [
        "export { App } from './src/app/app'",
        "export { CaptchaSolver } from './src/captcha/captcha-solver'",
        "export { AnswerSubmitter } from './src/captcha/answer-submitter'",
        "export { timingConfig } from '@hv-pony-solver/browser-core'",
        "export { HistoryStore } from './src/persistence/answer-history-store'",
        "export { StatusPanel } from './src/status-panel/status-panel'",
      ].join('\n'),
      resolveDir: appRoot,
      sourcefile: 'e2e-userscript-entry.ts',
    },
    alias: {
      '@hv-pony-solver/shared': path.join(repoRoot, 'packages/shared/src'),
    },
  })
  const bundleText = browserBundle.outputFiles[0]?.text
  if (!bundleText) {
    throw new Error('Failed to build userscript e2e browser bundle')
  }
  return bundleText
}

test('userscript app solves a local captcha with mocked browser detector', async ({ page }) => {
  const bundleText = await buildBrowserBundle()

  const submittedEvents: Array<{ answers: string[]; source: string }> = []
  await page.route(localCaptchaUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOsL2Z3wAAAABJRU5ErkJggg==',
        'base64',
      ),
    })
  })
  await page.route(localPageUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `
        <!doctype html>
        <html>
          <body>
            <div id="riddlemaster">
              <form name="riddleform" action="/riddle/submit">
                <div id="riddleimage"><img src="/captcha.png" alt="mock captcha"></div>
                <label><input type="checkbox" name="riddleanswer[]" value="TS">TS</label>
                <label><input type="checkbox" name="riddleanswer[]" value="RA">RA</label>
                <label><input type="checkbox" name="riddleanswer[]" value="FS">FS</label>
                <label><input type="checkbox" name="riddleanswer[]" value="RD">RD</label>
                <label><input type="checkbox" name="riddleanswer[]" value="PP">PP</label>
                <label><input type="checkbox" name="riddleanswer[]" value="AJ">AJ</label>
                <input id="riddlesubmit" type="submit" value="submit">
              </form>
            </div>
            <script>
              window.__ponyClicks = [];
              const form = document.querySelector('form[name="riddleform"]');
              form.querySelectorAll('input[name="riddleanswer[]"]').forEach((input) => {
                input.addEventListener('click', () => window.__ponyClicks.push(input.value));
              });
              form.addEventListener('submit', (event) => {
                event.preventDefault();
                window.recordSubmittedAnswers({
                  answers: Array.from(form.querySelectorAll('input[name="riddleanswer[]"]:checked')).map((input) => input.value),
                  source: event.type,
                });
              });
            </script>
          </body>
        </html>
      `,
    })
  })
  await page.exposeFunction('recordSubmittedAnswers', (event: { answers: string[]; source: string }) => {
    submittedEvents.push(event)
  })

  await page.goto(localPageUrl)

  await page.addScriptTag({ content: bundleText })
  await page.evaluate(() => {
    window.HvPonySolverE2E.timingConfig.submitDelay = [0, 0]
    window.HvPonySolverE2E.timingConfig.multiClickDelay = [0, 0]
    const panel = new window.HvPonySolverE2E.StatusPanel(new window.HvPonySolverE2E.HistoryStore())
    const mockModelCache = {
      download: async () => new ArrayBuffer(0),
      putCached: async () => undefined,
      close: () => undefined,
    }
    const mockDetector = {
      prepare: async () => ({}),
      detect: async () => ({
        success: true,
        ponies: ['RA'],
        confidences: { RA: 0.97 },
        detections: [],
        candidates: [],
      }),
      destroy: () => undefined,
    }
    const app = new window.HvPonySolverE2E.App({
      panel,
      modelCache: mockModelCache,
      detector: mockDetector,
      solver: new window.HvPonySolverE2E.CaptchaSolver(
        panel,
        mockDetector,
        { get: async () => new Blob(['captcha'], { type: 'image/png' }) },
        new window.HvPonySolverE2E.AnswerSubmitter(),
        async () => 'auto',
      ),
    })
    window.__hvPonySolverE2EApp = app
    app.init()
  })

  await expect(page.locator('.ponyLog')).toContainText('运行: 本地 ONNX')
  await expect.poll(() => page.evaluate(() => window.__ponyClicks), { timeout: 5_000 }).toEqual(['RA'])
  await expect.poll(() => submittedEvents, { timeout: 5_000 }).toEqual([{ answers: ['RA'], source: 'submit' }])
  await expect(page.locator('input[name="riddleanswer[]"]').nth(1)).toBeChecked()
  await expect(page.locator('input[name="riddleanswer[]"]').nth(0)).not.toBeChecked()
})

test('userscript history keeps concurrent same-origin tab writes and preserves the legacy root', async ({ page }) => {
  const bundleText = await buildBrowserBundle()
  const sibling = await page.context().newPage()
  const blankPage = '<!doctype html><html><body><main>history fixture</main></body></html>'
  const serveBlankPage = (route: {
    fulfill(options: { status: number; contentType: string; body: string }): Promise<void>
  }) => route.fulfill({ status: 200, contentType: 'text/html', body: blankPage })

  await page.route(localPageUrl, serveBlankPage)
  await sibling.route(localPageUrl, serveBlankPage)
  await Promise.all([page.goto(localPageUrl), sibling.goto(localPageUrl)])
  await page.evaluate(() => localStorage.clear())

  const legacyRoot = JSON.stringify({
    main: [{ type: 'success', answers: 'LEGACY', elapsed: 1, timestamp: 1, time: '00:00:01' }],
  })
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: HISTORY_KEY, value: legacyRoot })
  await Promise.all([page.addScriptTag({ content: bundleText }), sibling.addScriptTag({ content: bundleText })])

  const launchAt = Date.now() + 200
  const writeRecords = (tab: typeof page, prefix: string) =>
    tab.evaluate(
      async ({ launchAt: scheduledAt, prefix: recordPrefix }) => {
        while (Date.now() < scheduledAt) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1))
        }
        const store = new window.HvPonySolverE2E.HistoryStore()
        const persisted = []
        for (let index = 0; index < 30; index += 1) {
          persisted.push(
            store.add('main', {
              type: 'success',
              answers: `${recordPrefix}-${index}`,
              elapsed: index,
              timestamp: index + 1,
              time: '00:00:00',
            }).persisted,
          )
        }
        await Promise.all(persisted)
      },
      { launchAt, prefix },
    )

  await Promise.all([writeRecords(page, 'TAB-A'), writeRecords(sibling, 'TAB-B')])

  const snapshot = (tab: typeof page) =>
    tab.evaluate(
      ({ entryPrefix, historyKey }) => {
        const records = new window.HvPonySolverE2E.HistoryStore().get('main')
        return {
          answers: records.map((record) => record.answers),
          entryCount: Object.keys(localStorage).filter((key) => key.startsWith(entryPrefix)).length,
          legacyRoot: localStorage.getItem(historyKey),
        }
      },
      { entryPrefix: HISTORY_ENTRY_PREFIX, historyKey: HISTORY_KEY },
    )
  const [firstConcurrentSnapshot, secondConcurrentSnapshot] = await Promise.all([snapshot(page), snapshot(sibling)])

  for (const result of [firstConcurrentSnapshot, secondConcurrentSnapshot]) {
    // Each tab trims from its own snapshot. The concurrent writes can leave
    // more than HISTORY_MAX physical keys until a later normal mutation.
    expect(result.entryCount).toBeGreaterThanOrEqual(HISTORY_MAX)
    expect(result.answers).toHaveLength(HISTORY_MAX)
    expect(result.answers).toEqual(expect.arrayContaining(['TAB-A-29', 'TAB-B-29']))
    expect(result.legacyRoot).toBe(legacyRoot)
  }

  await page.evaluate(async () => {
    const mutation = new window.HvPonySolverE2E.HistoryStore().add('main', {
      type: 'success',
      answers: 'POST-TRIM',
      elapsed: 0,
      timestamp: 100,
      time: '00:01:40',
    })
    await mutation.persisted
  })
  const [firstSnapshot, secondSnapshot] = await Promise.all([snapshot(page), snapshot(sibling)])
  for (const result of [firstSnapshot, secondSnapshot]) {
    expect(result.entryCount).toBe(HISTORY_MAX)
    expect(result.answers).toHaveLength(HISTORY_MAX)
    expect(result.answers).toEqual(expect.arrayContaining(['POST-TRIM', 'TAB-A-29', 'TAB-B-29']))
    expect(result.legacyRoot).toBe(legacyRoot)
  }
  await sibling.close()
})
