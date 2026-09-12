import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../src/app/app'
import type { AppDependencies, SolverService } from '../../src/app/app-dependencies'
import { AnswerSubmitter } from '../../src/captcha/answer-submitter'
import { CaptchaSolver } from '../../src/captcha/captcha-solver'
import type { CaptchaTarget } from '../../src/captcha/captcha-target'
import type { DetectorService, YoloParseResult } from '../../src/inference/inference-types'
import { PermanentModelError } from '../../src/model/permanent-model-error'
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
    history.replaceState(null, '', '/')
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

  it('handles checkbox-driven submit readiness with one detect, submit, and history entry', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const answers = Array.from(captcha.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]'))
    const button = captcha.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.disabled = true
    for (const answer of answers) {
      answer.addEventListener('change', () => {
        const selectedCount = answers.filter((candidate) => candidate.checked).length
        button.disabled = selectedCount === 0 || selectedCount >= 4
      })
    }
    const panel = createPanel()
    const detector = createDetector()
    vi.mocked(detector.detect).mockResolvedValue({
      success: true,
      ponies: ['TS'],
      confidences: { TS: 0.99 },
      detections: [],
      candidates: [],
    })
    const solver = new CaptchaSolver(
      panel,
      detector,
      { get: async () => new Blob(['captcha']) },
      new AnswerSubmitter(
        async () => [0, 0],
        async () => [0, 0],
      ),
      async () => 'auto',
    )
    const buttonClick = vi.spyOn(button, 'click')
    const { app } = createHarness({ panel, detector, solver })
    apps.push(app)

    app.init()
    await settleDom()

    expect(detector.detect).toHaveBeenCalledTimes(1)
    expect(buttonClick).toHaveBeenCalledTimes(1)
    expect(panel.addSuccess).toHaveBeenCalledTimes(1)

    captcha.appendChild(document.createElement('span'))
    await settleDom()

    expect(detector.detect).toHaveBeenCalledTimes(1)
    expect(buttonClick).toHaveBeenCalledTimes(1)
    expect(panel.addSuccess).toHaveBeenCalledTimes(1)
  })

  it.each(['auto', 'manual'] as const)(
    'includes preparation and retries in %s history without counting clock changes or previous targets',
    async (answerMode) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
      const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
      const captcha = appendCaptcha('/timing-first.png')
      const button = captcha.querySelector<HTMLInputElement>('#riddlesubmit')!
      vi.spyOn(button, 'click').mockImplementation(() => undefined)
      const panel = createPanel()
      const detector = createDetector()
      vi.mocked(detector.prepare)
        .mockImplementation(async () => delay(200))
        .mockRejectedValueOnce(new Error('temporary preparation failure'))
      vi.mocked(detector.detect).mockImplementation(async () => {
        await delay(50)
        vi.setSystemTime(Date.now() - 10_000)
        return { success: true, ponies: ['TS'], confidences: { TS: 0.9 }, detections: [], candidates: [] }
      })
      const solver = new CaptchaSolver(
        panel,
        detector,
        {
          get: async () => {
            await delay(30)
            return new Blob(['captcha'])
          },
        },
        new AnswerSubmitter(
          async () => [500, 500],
          async () => [0, 0],
        ),
        async () => {
          await delay(20)
          return answerMode
        },
      )
      const { app } = createHarness({ panel, detector, solver })
      apps.push(app)
      app.init()
      await settleDom()

      const record = answerMode === 'auto' ? panel.addSuccess : panel.addManualResult
      expect(record).toHaveBeenLastCalledWith(['TS'], { TS: 0.9 }, answerMode === 'auto' ? 1050 : 550)
      expect(panel.setStatus).toHaveBeenLastCalledWith({ inference: '完成 50ms' })
      expect(button.click).toHaveBeenCalledTimes(answerMode === 'auto' ? 1 : 0)

      captcha.querySelector('img')!.src = '/timing-second.png'
      await settleDom()

      expect(record).toHaveBeenCalledTimes(2)
      expect(record).toHaveBeenLastCalledWith(['TS'], { TS: 0.9 }, answerMode === 'auto' ? 800 : 300)
    },
  )

  it('suppresses repeated solver failures for the same captcha during the cooldown', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const harness = createHarness()
    harness.trigger.mockImplementation(async (target?: CaptchaTarget) => ({
      handled: false,
      captchaKey: target?.captchaKey ?? null,
    }))
    apps.push(harness.app)

    harness.app.init()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    captcha.appendChild(document.createElement('span'))
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    vi.setSystemTime(Date.now() + 30_000)
    captcha.appendChild(document.createElement('strong'))
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)
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

  it('does not accept a solve completed after a URL-only navigation', async () => {
    let resolveFirst: ((result: { handled: boolean; captchaKey: string | null }) => void) | undefined
    const firstResult = new Promise<{ handled: boolean; captchaKey: string | null }>((resolve) => {
      resolveFirst = resolve
    })
    const harness = createHarness()
    harness.trigger.mockReturnValueOnce(firstResult).mockImplementation(async (target?: CaptchaTarget) => ({
      handled: true,
      captchaKey: target?.captchaKey ?? null,
    }))
    apps.push(harness.app)

    harness.app.init()
    const captcha = appendCaptcha('/captcha.png')
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    history.pushState(null, '', '/next')
    resolveFirst?.({ handled: true, captchaKey: 'http://localhost:3000/captcha.png' })
    await settleDom()

    captcha.appendChild(document.createElement('span'))
    await settleDom()

    expect(harness.trigger).toHaveBeenCalledTimes(2)
  })

  it('rescans a handled target when responsive image selection changes through srcset', async () => {
    const captcha = appendCaptcha('/captcha-a.png')
    const image = captcha.querySelector('img')!
    let currentSrc = 'http://localhost:3000/captcha-a.png'
    Object.defineProperty(image, 'currentSrc', {
      configurable: true,
      get: () => currentSrc,
    })
    const harness = createHarness()
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    currentSrc = 'http://localhost:3000/captcha-b.png'
    image.srcset = '/captcha-b.png 1x'
    await settleDom()

    expect(harness.trigger).toHaveBeenCalledTimes(2)
    expect(harness.trigger.mock.calls[1]?.[0]?.captchaKey).toContain('/captcha-b.png')
  })

  it('rescans a handled target when an answer control becomes disabled', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const harness = createHarness()
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    captcha.querySelector<HTMLInputElement>('input[name="riddleanswer[]"]')!.disabled = true
    await settleDom()

    expect(harness.trigger).toHaveBeenCalledTimes(2)
  })

  it('retries a suppressed failed captcha exactly once when its submit button becomes enabled', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const submit = captcha.querySelector<HTMLInputElement>('#riddlesubmit')!
    submit.disabled = true
    const harness = createHarness()
    harness.trigger.mockImplementation(async (target?: CaptchaTarget) => ({
      handled: false,
      captchaKey: target?.captchaKey ?? null,
    }))
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    captcha.appendChild(document.createElement('span'))
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    submit.disabled = false
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)

    captcha.appendChild(document.createElement('strong'))
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)
  })

  it.each(['unhandled', 'exception'] as const)(
    'captures the latest enabled snapshot after a solver %s and suppresses pending scans',
    async (failure) => {
      const captcha = appendCaptcha('/captcha.png')
      const submit = captcha.querySelector<HTMLInputElement>('#riddlesubmit')!
      submit.disabled = true
      const harness = createHarness()
      harness.trigger.mockImplementation(async (target?: CaptchaTarget) => {
        submit.disabled = false
        if (failure === 'exception') {
          throw new Error('solver failed')
        }
        return { handled: false, captchaKey: target?.captchaKey ?? null }
      })
      apps.push(harness.app)

      harness.app.init()
      await settleDom()

      expect(harness.trigger).toHaveBeenCalledTimes(1)

      captcha.appendChild(document.createElement('span'))
      await settleDom()

      expect(harness.trigger).toHaveBeenCalledTimes(1)
    },
  )

  it('captures the latest enabled snapshot after prepare fails and suppresses pending scans', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const submit = captcha.querySelector<HTMLInputElement>('#riddlesubmit')!
    submit.disabled = true
    const harness = createHarness()
    vi.mocked(harness.detector.prepare).mockImplementation(async () => {
      submit.disabled = false
      throw new PermanentModelError('模型 Key 无效')
    })
    apps.push(harness.app)

    harness.app.init()
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)
    expect(harness.trigger).not.toHaveBeenCalled()

    captcha.appendChild(document.createElement('span'))
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)
    expect(harness.trigger).not.toHaveBeenCalled()
  })

  it('does not let submit readiness bypass a permanent prepare failure', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const submit = captcha.querySelector<HTMLInputElement>('#riddlesubmit')!
    submit.disabled = true
    const harness = createHarness()
    vi.mocked(harness.detector.prepare).mockRejectedValue(new PermanentModelError('模型 Key 无效'))
    apps.push(harness.app)

    harness.app.init()
    await settleDom()
    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)

    submit.disabled = false
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)
    expect(harness.trigger).not.toHaveBeenCalled()
  })

  it('keeps a transient prepare failure suppressed through submit readiness until its retry window expires', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const submit = captcha.querySelector<HTMLInputElement>('#riddlesubmit')!
    submit.disabled = true
    const harness = createHarness()
    vi.mocked(harness.detector.prepare).mockRejectedValue(new Error('host down'))
    apps.push(harness.app)

    harness.app.init()
    await vi.advanceTimersByTimeAsync(1_100)
    await Promise.resolve()
    expect(harness.detector.prepare).toHaveBeenCalledTimes(3)

    submit.disabled = false
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(100)
    await Promise.resolve()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(3)
    expect(harness.trigger).not.toHaveBeenCalled()

    vi.setSystemTime(Date.now() + 30_000)
    captcha.appendChild(document.createElement('span'))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1_100)
    await Promise.resolve()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(6)
    expect(harness.trigger).not.toHaveBeenCalled()
  })

  it.each(['formaction', 'type'])('rescans after the submit control %s changes', async (attribute) => {
    const captcha = appendCaptcha('/captcha.png')
    const harness = createHarness()
    harness.setBusy(true)
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    expect(harness.trigger).not.toHaveBeenCalled()

    harness.setBusy(false)
    captcha.submitButton.setAttribute(attribute, attribute === 'type' ? 'submit' : '/submit')
    await settleDom()

    expect(harness.trigger).toHaveBeenCalledTimes(1)
  })

  it('starts solving when a form action recovers from cross-origin to same-origin', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const form = captcha.querySelector<HTMLFormElement>('form')!
    form.action = 'https://example.invalid/submit'
    const harness = createHarness()
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    expect(harness.trigger).not.toHaveBeenCalled()

    form.action = '/submit'
    await settleDom()

    expect(harness.trigger).toHaveBeenCalledTimes(1)
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

  it('abandons the old target and retries when form action changes while prepare is pending', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const form = captcha.querySelector<HTMLFormElement>('form')
    if (!form) throw new Error('captcha form missing')
    form.action = '/submit'
    const harness = createHarness()
    vi.mocked(harness.detector.prepare).mockImplementation(async () => {
      form.action = '/other-submit'
    })
    apps.push(harness.app)

    harness.app.init()
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
    expect(harness.trigger).toHaveBeenCalledTimes(1)
    expect(harness.trigger.mock.calls[0]?.[0]?.formAction).toBe('http://localhost:3000/other-submit')
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

  it('does not retry a reconstructed permanent model prepare failure', async () => {
    appendCaptcha('/captcha.png')
    const harness = createHarness()
    vi.mocked(harness.detector.prepare).mockRejectedValue(
      new PermanentModelError('模型 Key 无效或已失效，请在设置中重新验证 Key'),
    )
    apps.push(harness.app)

    harness.app.init()
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)
    expect(harness.trigger).not.toHaveBeenCalled()
  })

  it('cancels and retries an active solve after model credentials change', async () => {
    let resolveFirst: ((result: { handled: boolean; captchaKey: string | null }) => void) | undefined
    const firstResult = new Promise<{ handled: boolean; captchaKey: string | null }>((resolve) => {
      resolveFirst = resolve
    })
    const harness = createHarness()
    harness.trigger.mockReturnValueOnce(firstResult).mockImplementation(async (target?: CaptchaTarget) => ({
      handled: true,
      captchaKey: target?.captchaKey ?? null,
    }))
    apps.push(harness.app)

    harness.app.init()
    appendCaptcha('/captcha.png')
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)
    const oldSignal = harness.app.getAbortSignal()

    harness.app.recoverAfterModelCredentialsChanged()

    expect(oldSignal?.aborted).toBe(true)
    expect(harness.app.getAbortSignal()).not.toBe(oldSignal)

    resolveFirst?.({ handled: true, captchaKey: 'http://localhost:3000/captcha.png' })
    await settleDom()

    expect(harness.trigger).toHaveBeenCalledTimes(2)
  })

  it('passes the captured solve signal when credentials change between prepare and trigger', async () => {
    const appRef: { current?: App } = {}
    const detector = createDetector()
    const prepareThenable = {
      then(resolve: (value: void) => void): void {
        resolve()
        queueMicrotask(() => appRef.current?.recoverAfterModelCredentialsChanged())
      },
    }
    vi.mocked(detector.prepare)
      .mockReturnValueOnce(prepareThenable as unknown as Promise<void>)
      .mockResolvedValue(undefined)
    let submissions = 0
    const trigger = vi.fn(async (target?: CaptchaTarget, _startedAt?: number, signal?: AbortSignal) => {
      if (!signal?.aborted) {
        submissions += 1
      }
      return {
        handled: signal?.aborted !== true,
        captchaKey: target?.captchaKey ?? null,
      }
    })
    const solver: SolverService = { isBusy: false, trigger }
    const harness = createHarness({ detector, solver })
    const app = harness.app
    appRef.current = app
    apps.push(app)

    app.init()
    appendCaptcha('/captcha.png')
    await settleDom()

    expect(trigger).toHaveBeenCalledTimes(2)
    expect(trigger.mock.calls[0]?.[2]?.aborted).toBe(true)
    expect(trigger.mock.calls[1]?.[2]?.aborted).toBe(false)
    expect(submissions).toBe(1)
  })

  it('retries the same failed captcha exactly once after model credentials change', async () => {
    appendCaptcha('/captcha.png')
    const harness = createHarness()
    vi.mocked(harness.detector.prepare)
      .mockRejectedValueOnce(new PermanentModelError('模型 Key 无效'))
      .mockResolvedValue(undefined)
    apps.push(harness.app)

    harness.app.init()
    await settleDom()
    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)
    expect(harness.trigger).not.toHaveBeenCalled()

    harness.app.recoverAfterModelCredentialsChanged()
    harness.app.recoverAfterModelCredentialsChanged()
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    harness.app.recoverAfterModelCredentialsChanged()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)
  })

  it('invalidates an in-flight old-credential prepare and retries the same captcha once', async () => {
    let resolveOldPrepare: (() => void) | undefined
    appendCaptcha('/captcha.png')
    const harness = createHarness()
    vi.mocked(harness.detector.prepare)
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveOldPrepare = resolve
        }),
      )
      .mockResolvedValue(undefined)
    apps.push(harness.app)

    harness.app.init()
    await vi.advanceTimersByTimeAsync(100)
    await Promise.resolve()
    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)

    harness.app.recoverAfterModelCredentialsChanged()
    resolveOldPrepare?.()
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
    expect(harness.trigger).toHaveBeenCalledTimes(1)
  })

  it('does not retry a normally handled captcha after model credentials change', async () => {
    appendCaptcha('/captcha.png')
    const harness = createHarness()
    apps.push(harness.app)

    harness.app.init()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    harness.app.recoverAfterModelCredentialsChanged()
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)
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

  it('retries a transient-failure suppression once its expiry passes', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const harness = createHarness()
    vi.mocked(harness.detector.prepare).mockRejectedValue(new Error('host down'))
    apps.push(harness.app)

    harness.app.init()
    await settleDom()
    expect(harness.detector.prepare).toHaveBeenCalledTimes(3)

    vi.setSystemTime(Date.now() + 31_000)
    captcha.appendChild(document.createElement('span'))
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(6)
    expect(harness.trigger).not.toHaveBeenCalled()
  })

  it('keeps an unexpected solver exception recoverable through credentials change', async () => {
    appendCaptcha('/captcha.png')
    const harness = createHarness()
    harness.trigger.mockRejectedValueOnce(new Error('面板异常'))
    apps.push(harness.app)

    harness.app.init()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    harness.app.recoverAfterModelCredentialsChanged()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)
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
