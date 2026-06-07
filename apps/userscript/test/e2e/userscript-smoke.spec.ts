import { Buffer } from 'node:buffer'
import { expect, test } from '@playwright/test'
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(dirname, '../..')
const repoRoot = path.resolve(appRoot, '../..')

const localPageUrl = 'http://pony-solver-e2e.local/riddle'
const localCaptchaUrl = 'http://pony-solver-e2e.local/captcha.png'

test('userscript app solves a local captcha with mocked browser detector', async ({ page }) => {
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
        "export { timingConfig } from './src/captcha/timing-config'",
        "export { HistoryStore } from './src/persistence/answer-history-store'",
        "export { StatusPanel } from './src/status-panel/status-panel'",
      ].join('\n'),
      resolveDir: appRoot,
      sourcefile: 'e2e-userscript-entry.ts',
    },
    alias: {
      '@hv-pony-solver/shared': path.join(repoRoot, 'packages/shared/src/index.ts'),
    },
  })
  const bundleText = browserBundle.outputFiles[0]?.text
  if (!bundleText) {
    throw new Error('Failed to build userscript e2e browser bundle')
  }

  const submittedEvents: Array<{ answers: string[], source: string }> = []
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
  await page.exposeFunction('recordSubmittedAnswers', (event: { answers: string[], source: string }) => {
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
