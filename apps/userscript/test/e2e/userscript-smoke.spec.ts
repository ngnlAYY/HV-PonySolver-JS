import { Buffer } from 'node:buffer'
import { expect, test, type Page } from '@playwright/test'
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HISTORY_ENTRY_PREFIX,
  HISTORY_KEY,
  HISTORY_MAX,
} from '@hv-pony-solver/browser-core/persistence/answer-history-config'

type E2EHistoryRecord = Readonly<{
  type: string
  answers: string
  elapsed: number
  timestamp: number
  time: string
}>

type E2EHistoryStore = Readonly<{
  get(world: string): E2EHistoryRecord[]
  add(world: string, record: E2EHistoryRecord): Readonly<{ persisted: Promise<void> }>
}>

type E2EDetectionResult = Readonly<{
  success: boolean
  ponies: string[]
  confidences: Readonly<Record<string, number>>
  detections: readonly object[]
  candidates: readonly object[]
}>

type E2EDetector = Readonly<{
  prepare(): Promise<object>
  detect(image: Blob, signal?: AbortSignal): Promise<E2EDetectionResult>
  destroy(): void
}>

type E2EModelCache = Readonly<{
  download(): Promise<ArrayBuffer>
  putCached(...args: never[]): Promise<void>
  close(): void
}>

type E2EApi = Readonly<{
  timingConfig: {
    submitDelay: [number, number]
    multiClickDelay: [number, number]
  }
  StatusPanel: new (history: E2EHistoryStore) => object
  HistoryStore: new () => E2EHistoryStore
  CaptchaSolver: new (
    panel: object,
    detector: E2EDetector,
    imageLoader: Readonly<{ get(url: string): Promise<Blob> }>,
    answerSubmitter: object,
    getAnswerMode: () => Promise<'auto' | 'manual'>,
  ) => Readonly<{ isBusy: boolean }>
  AnswerSubmitter: new () => object
  getAnswerMode(): Promise<'auto' | 'manual'>
  App: new (
    dependencies: Readonly<{
      panel: object
      modelCache: E2EModelCache
      detector: E2EDetector
      solver: object
    }>,
  ) => Readonly<{ init(): void | Promise<void>; destroy(): void }>
}>

declare global {
  interface Window {
    HvPonySolverE2E: E2EApi
    __hvPonySolverE2EApp: Readonly<{ init(): void | Promise<void> }>
    __ponyClicks: string[]
    __ponyLifecycle: {
      imageUrls: string[]
      submissions: string[]
      unhandled: string[]
      settingBlocked: boolean
      releaseDetection?: () => void
      rejectSettings?: () => void
      isBusy(): boolean
      destroy(): void
    }
  }
}

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
        "export { getAnswerMode } from './src/captcha/answer-mode-settings'",
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

async function startLifecycleFixture(
  page: Page,
  options: Readonly<{
    picture?: boolean
    pauseDetection?: boolean
    blockedSetting?: string
    missingBody?: boolean
  }> = {},
): Promise<Readonly<{ releaseImage(pathname: string): void }>> {
  const bundle = await buildBrowserBundle()
  const imageBytes = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 8
      return canvas.toDataURL('image/png').split(',')[1] ?? ''
    }),
    'base64',
  )
  const releaseImages = new Map<string, () => void>()
  const pendingImages = new Map(
    ['/next.png', '/last.png'].map((pathname) => [
      pathname,
      new Promise<void>((resolve) => releaseImages.set(pathname, resolve)),
    ]),
  )
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(localPageUrl).origin) return route.abort()
    if (url.pathname.endsWith('.png')) {
      await pendingImages.get(url.pathname)
      return route.fulfill({ status: 200, contentType: 'image/png', body: imageBytes })
    }
    const image = '<img src="/captcha.png" alt="PUBLIC captcha fixture">'
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
      <div id="riddlemaster"><form name="riddleform">
        <div id="riddleimage">${options.picture ? `<picture><source srcset="/captcha.png 1x">${image}</picture>` : image}</div>
        ${['TS', 'RA', 'FS', 'RD', 'PP', 'AJ'].map((value) => `<input type="checkbox" name="riddleanswer[]" value="${value}">`).join('')}
        <input id="riddlesubmit" type="button">
      </form></div></body></html>`,
    })
  })
  await page.goto(localPageUrl)
  await page.waitForFunction(() => {
    const image = document.querySelector('img')
    return image?.complete && image.naturalWidth > 0
  })
  await page.addScriptTag({ content: bundle })
  await page.evaluate(({ pauseDetection, blockedSetting, missingBody }) => {
    const state = (window.__ponyLifecycle = {
      imageUrls: [] as string[],
      submissions: [] as string[],
      unhandled: [] as string[],
      settingBlocked: false,
      isBusy: () => false,
      destroy: () => undefined,
    } as Window['__ponyLifecycle'])
    window.addEventListener('unhandledrejection', (event) => state.unhandled.push(String(event.reason)))
    Object.defineProperty(window, 'GM', {
      configurable: true,
      value: {
        getValue(key: string, fallback: string): string | Promise<string> {
          if (key === blockedSetting && !state.settingBlocked) {
            state.settingBlocked = true
            return new Promise((_resolve, reject) => {
              state.rejectSettings = () => reject(new Error('PUBLIC late settings rejection'))
            })
          }
          if (key === 'hvPonySolverAnswerMode') return 'auto'
          if (key === 'hvPonySolverSubmitDelay' || key === 'hvPonySolverMultiClickDelay') return '0'
          return fallback
        },
      },
    })
    const image = document.querySelector('img')
    const button = document.querySelector('#riddlesubmit')
    if (!image || !button) throw new Error('captcha fixture missing')
    button.addEventListener('click', () => state.submissions.push(image.currentSrc || image.src))
    const panel = new window.HvPonySolverE2E.StatusPanel(new window.HvPonySolverE2E.HistoryStore())
    let first = true
    const detector: E2EDetector = {
      prepare: async () => ({}),
      detect: async () => {
        if (first && pauseDetection) {
          first = false
          await new Promise<void>((resolve) => {
            state.releaseDetection = resolve
          })
        }
        return { success: true, ponies: ['RA'], confidences: { RA: 0.97 }, detections: [], candidates: [] }
      },
      destroy: () => undefined,
    }
    const solver = new window.HvPonySolverE2E.CaptchaSolver(
      panel,
      detector,
      {
        get: async (url) => {
          state.imageUrls.push(url)
          return new Blob(['PUBLIC_TEST_IMAGE'], { type: 'image/png' })
        },
      },
      new window.HvPonySolverE2E.AnswerSubmitter(),
      window.HvPonySolverE2E.getAnswerMode,
    )
    const app = new window.HvPonySolverE2E.App({
      panel,
      detector,
      solver,
      modelCache: {
        download: async () => new ArrayBuffer(0),
        putCached: async () => undefined,
        close: () => undefined,
      },
    })
    state.isBusy = () => solver.isBusy
    state.destroy = () => app.destroy()
    const body = document.body
    if (missingBody) body.remove()
    try {
      app.init()
    } finally {
      if (missingBody) document.documentElement.appendChild(body)
    }
  }, options)
  return { releaseImage: (pathname) => releaseImages.get(pathname)?.() }
}

for (const picture of [false, true]) {
  test(`userscript waits for slow ${picture ? 'picture source' : 'srcset'} selection and cancels the old answer`, async ({
    page,
  }) => {
    const fixture = await startLifecycleFixture(page, { picture, pauseDetection: true })
    try {
      await expect.poll(() => page.evaluate(() => typeof window.__ponyLifecycle.releaseDetection)).toBe('function')
      const selectImage = async (pathname: string): Promise<void> => {
        const requested = page.waitForRequest(new URL(pathname, localPageUrl).href)
        await page.evaluate(
          ({ pathname, picture }) => {
            const source = document.querySelector(picture ? 'source' : 'img')
            if (!source) throw new Error('image source missing')
            source.setAttribute('srcset', `${pathname} 1x`)
          },
          { pathname, picture },
        )
        await requested
      }
      await selectImage('/next.png')
      await page.evaluate(() => window.__ponyLifecycle.releaseDetection?.())
      // Hold the native image request beyond App's scan debounce.
      await page.waitForTimeout(200)
      expect(
        await page.evaluate(() => ({
          urls: window.__ponyLifecycle.imageUrls,
          submissions: window.__ponyLifecycle.submissions,
        })),
      ).toEqual({ urls: [localCaptchaUrl], submissions: [] })
      fixture.releaseImage('/next.png')
      const next = new URL('/next.png', localPageUrl).href
      await expect.poll(() => page.evaluate(() => window.__ponyLifecycle.submissions)).toEqual([next])

      await selectImage('/last.png')
      await page.waitForTimeout(200)
      expect(await page.evaluate(() => window.__ponyLifecycle.imageUrls)).toEqual([localCaptchaUrl, next])
      fixture.releaseImage('/last.png')
      const last = new URL('/last.png', localPageUrl).href
      await expect.poll(() => page.evaluate(() => window.__ponyLifecycle.submissions)).toEqual([next, last])
      expect(await page.evaluate(() => window.__ponyLifecycle.imageUrls)).toEqual([localCaptchaUrl, next, last])
      expect(await page.evaluate(() => window.__ponyLifecycle.unhandled)).toEqual([])
      await page.evaluate(() => window.__ponyLifecycle.destroy())
    } finally {
      fixture.releaseImage('/next.png')
      fixture.releaseImage('/last.png')
    }
  })
}

for (const blockedSetting of ['hvPonySolverAnswerMode', 'hvPonySolverSubmitDelay', 'hvPonySolverMultiClickDelay']) {
  test(`userscript cancels pending GM ${blockedSetting} reads before solving the next image`, async ({ page }) => {
    await startLifecycleFixture(page, { blockedSetting })
    await expect.poll(() => page.evaluate(() => window.__ponyLifecycle.settingBlocked)).toBe(true)
    await page.evaluate(() => {
      const image = document.querySelector('img')
      if (!image) throw new Error('image missing')
      image.src = '/replacement.png'
    })
    const next = new URL('/replacement.png', localPageUrl).href
    await expect.poll(() => page.evaluate(() => window.__ponyLifecycle.submissions)).toEqual([next])
    expect(await page.evaluate(() => window.__ponyLifecycle.imageUrls)).toEqual([localCaptchaUrl, next])
    expect(await page.evaluate(() => window.__ponyLifecycle.isBusy())).toBe(false)
    await page.evaluate(() => window.__ponyLifecycle.rejectSettings?.())
    await page.waitForTimeout(100)
    expect(await page.evaluate(() => window.__ponyLifecycle.submissions)).toEqual([next])
    expect(await page.evaluate(() => window.__ponyLifecycle.unhandled)).toEqual([])
  })
}

test('userscript mounts and solves when body first appears after App initialization', async ({ page }) => {
  await startLifecycleFixture(page, { missingBody: true })
  await expect.poll(() => page.evaluate(() => window.__ponyLifecycle.submissions)).toEqual([localCaptchaUrl])
  await expect(page.locator('.ponyLog')).toHaveCount(1)
})

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
