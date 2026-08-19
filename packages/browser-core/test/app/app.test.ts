import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../src/app/app'
import type { AppDependencies, SolverService } from '../../src/app/app-dependencies'
import type { CaptchaTarget } from '../../src/captcha/captcha-target'
import type { DetectorService, YoloParseResult } from '../../src/inference/inference-types'
import type { StatusPanel } from '../../src/status-panel/status-panel-types'
import { appendCaptcha } from '../../../../test/support/captcha-fixture'

function createPanel(): StatusPanel {
  return {
    addError: vi.fn(),
    addManualResult: vi.fn(),
    addRandomFailure: vi.fn(),
    addSuccess: vi.fn(),
    create: vi.fn(),
    destroy: vi.fn(),
    setSessionReady: vi.fn(),
    setStatus: vi.fn(),
  }
}

function createDetector(): DetectorService {
  return {
    destroy: vi.fn(),
    detect: vi.fn(async (): Promise<YoloParseResult> => ({
      success: false,
      ponies: [],
      confidences: {},
      detections: [],
      candidates: [],
    })),
    prepare: vi.fn(async () => undefined),
  }
}

function createHarness(overrides: Partial<AppDependencies> = {}) {
  const panel = overrides.panel ?? createPanel()
  const detector = overrides.detector ?? createDetector()
  let busy = false
  const trigger = vi.fn(async (target?: CaptchaTarget) => ({
    handled: true,
    captchaKey: target?.captchaKey ?? null,
  }))
  const solver: SolverService = overrides.solver ?? {
    get isBusy() {
      return busy
    },
    trigger,
  }
  const registerSettings = overrides.registerSettings ?? vi.fn()
  const dispose = overrides.dispose ?? vi.fn()
  const app = new App({ detector, dispose, panel, registerSettings, solver })
  return {
    app,
    detector,
    dispose,
    panel,
    registerSettings,
    setBusy(value: boolean) {
      busy = value
    },
    solver,
    trigger,
  }
}

async function settleDom(): Promise<void> {
  await Promise.resolve()
  await vi.runAllTimersAsync()
  await Promise.resolve()
}

describe('App', () => {
  const apps: App[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    for (const app of apps) {
      app.destroy()
    }
    apps.length = 0
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('initializes the panel and settings exactly once without preparing an absent captcha', async () => {
    const harness = createHarness()
    apps.push(harness.app)

    expect(harness.app.getAbortSignal()).toBeUndefined()
    harness.app.init()
    const firstSignal = harness.app.getAbortSignal()
    harness.app.init()
    await settleDom()

    expect(firstSignal).toBeInstanceOf(AbortSignal)
    expect(harness.panel.create).toHaveBeenCalledTimes(2)
    expect(harness.registerSettings).toHaveBeenCalledTimes(1)
    expect(harness.detector.prepare).not.toHaveBeenCalled()
  })

  it('solves an existing captcha once and ignores unrelated mutations after handling', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const harness = createHarness()
    apps.push(harness.app)

    harness.app.init()
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(harness.trigger).toHaveBeenCalledTimes(1)
    expect(harness.trigger.mock.calls[0]?.[0]).toMatchObject({
      master: captcha,
      captchaKey: expect.stringContaining('/captcha.png'),
    })

    document.body.appendChild(document.createElement('aside'))
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)
  })

  it('waits for a complete captcha target and reacts to nested captcha mutations', async () => {
    const harness = createHarness()
    apps.push(harness.app)
    harness.app.init()
    const master = document.createElement('div')
    master.id = 'riddlemaster'
    document.body.appendChild(master)
    await settleDom()
    expect(harness.detector.prepare).not.toHaveBeenCalled()

    const complete = appendCaptcha('/complete.png')
    master.append(...complete.childNodes)
    complete.remove()
    await settleDom()

    expect(harness.trigger).toHaveBeenCalledTimes(1)
  })

  it('queues a same-URL replacement while a solve is running and never reuses target identity', async () => {
    let resolveFirst: (() => void) | undefined
    const firstResult = new Promise<{ handled: boolean; captchaKey: string }>((resolve) => {
      resolveFirst = () => resolve({ handled: false, captchaKey: 'http://localhost:3000/captcha.png' })
    })
    const harness = createHarness()
    harness.trigger.mockReturnValueOnce(firstResult).mockImplementation(async (target?: CaptchaTarget) => ({
      handled: true,
      captchaKey: target?.captchaKey ?? null,
    }))
    apps.push(harness.app)
    harness.app.init()
    const first = appendCaptcha('/captcha.png')
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    const replacement = appendCaptcha('/captcha.png')
    first.replaceWith(replacement)
    await settleDom()
    resolveFirst?.()
    await settleDom()

    expect(harness.trigger).toHaveBeenCalledTimes(2)
    expect(harness.trigger.mock.calls[0]?.[0]?.master).toBe(first)
    expect(harness.trigger.mock.calls[1]?.[0]?.master).toBe(replacement)
  })

  it('rescans a handled target after its image source changes', async () => {
    const captcha = appendCaptcha('/captcha-a.png')
    const harness = createHarness()
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    captcha.querySelector('img')!.src = '/captcha-b.png'
    await settleDom()

    expect(harness.trigger).toHaveBeenCalledTimes(2)
    expect(harness.trigger.mock.calls[1]?.[0]?.captchaKey).toContain('/captcha-b.png')
  })

  it('abandons a target replaced while prepare is pending and solves the replacement', async () => {
    let resolvePrepare: (() => void) | undefined
    const harness = createHarness()
    vi.mocked(harness.detector.prepare)
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolvePrepare = resolve
        }),
      )
      .mockResolvedValue(undefined)
    apps.push(harness.app)
    harness.app.init()
    const captcha = appendCaptcha('/captcha-a.png')
    await settleDom()
    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)

    captcha.querySelector('img')!.src = '/captcha-b.png'
    await settleDom()
    resolvePrepare?.()
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
    expect(harness.trigger).toHaveBeenCalledTimes(1)
    expect(harness.trigger.mock.calls[0]?.[0]?.captchaKey).toContain('/captcha-b.png')
  })

  it('retries after prepare failure and defers scans while the solver reports busy', async () => {
    const harness = createHarness()
    vi.mocked(harness.detector.prepare).mockRejectedValueOnce(new Error('prepare failed'))
    harness.setBusy(true)
    apps.push(harness.app)
    harness.app.init()
    const captcha = appendCaptcha('/captcha.png')
    await settleDom()
    expect(harness.detector.prepare).not.toHaveBeenCalled()

    harness.setBusy(false)
    captcha.appendChild(document.createElement('span'))
    await settleDom()
    expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    captcha.appendChild(document.createElement('strong'))
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)
  })

  it('retries transient prepare failures with backoff without requiring a DOM mutation', async () => {
    appendCaptcha('/captcha.png')
    const harness = createHarness()
    vi.mocked(harness.detector.prepare)
      .mockRejectedValueOnce(new Error('first prepare failure'))
      .mockRejectedValueOnce(new Error('second prepare failure'))
      .mockResolvedValue(undefined)
    apps.push(harness.app)

    harness.app.init()
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(3)
    expect(harness.trigger).toHaveBeenCalledTimes(1)
  })

  it('caps prepare retries for one target and does not restart them after unrelated mutations', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const harness = createHarness()
    vi.mocked(harness.detector.prepare).mockRejectedValue(new Error('persistent prepare failure'))
    apps.push(harness.app)

    harness.app.init()
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(3)
    expect(harness.trigger).not.toHaveBeenCalled()

    captcha.appendChild(document.createElement('span'))
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(3)
    expect(harness.trigger).not.toHaveBeenCalled()
  })

  it('aborts and suppresses late work during destroy, then can initialize a fresh lifecycle', async () => {
    let resolvePrepare: (() => void) | undefined
    const harness = createHarness()
    vi.mocked(harness.detector.prepare).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePrepare = resolve
      }),
    )
    const captcha = appendCaptcha('/captcha.png')
    harness.app.init()
    await settleDom()
    const signal = harness.app.getAbortSignal()

    harness.app.destroy()
    resolvePrepare?.()
    await settleDom()

    expect(signal?.aborted).toBe(true)
    expect(harness.trigger).not.toHaveBeenCalled()
    expect(harness.detector.destroy).toHaveBeenCalledTimes(1)
    expect(harness.dispose).toHaveBeenCalledTimes(1)
    expect(harness.panel.destroy).toHaveBeenCalledTimes(1)

    harness.app.init()
    captcha.querySelector('img')!.src = '/captcha-new.png'
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)
    harness.app.destroy()
  })
})
