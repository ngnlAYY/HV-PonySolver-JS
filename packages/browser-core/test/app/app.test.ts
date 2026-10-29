import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '../../src/app/app'
import type { AppDependencies, SolverService } from '../../src/app/app-dependencies'
import { AnswerSubmitter } from '../../src/captcha/answer-submitter'
import { CaptchaSolver, type SolveResult } from '../../src/captcha/captcha-solver'
import { findCaptchaTarget, type CaptchaTarget } from '../../src/captcha/captcha-target'
import type { DetectorService, YoloParseResult } from '../../src/inference/inference-types'
import { inferenceTimeoutConfig } from '../../src/inference/inference-config'
import { PermanentModelError } from '../../src/model/permanent-model-error'
import { downloadModel } from '../../src/model/model-downloader'
import { HistoryStore } from '../../src/persistence/answer-history-store'
import { StatusPanel as BrowserStatusPanel } from '../../src/status-panel/status-panel'
import { appendCaptcha } from '../../../../test/support/captcha-fixture'
import { createMockPanel as createPanel } from '../helpers/mock-panel'

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
  const trigger = vi.fn(async (target?: CaptchaTarget): Promise<SolveResult> => ({
    handled: true,
    captchaKey: target?.captchaKey ?? null,
    failure: null,
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
    if (!document.body) document.documentElement.appendChild(document.createElement('body'))
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

  it('starts the real panel without a body and handles the captcha inserted after body restoration', async () => {
    const panel = new BrowserStatusPanel(new HistoryStore(localStorage), {
      synchronousSnapshot: true,
      getSync: () => null,
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
    })
    const harness = createHarness({ panel })
    apps.push(harness.app)
    document.body.remove()
    expect(() => harness.app.init()).not.toThrow()
    await settleDom()
    expect(harness.trigger).not.toHaveBeenCalled()
    document.documentElement.appendChild(document.createElement('body'))
    appendCaptcha('/first-body.png')
    await settleDom()
    expect(document.querySelectorAll('.ponyLog')).toHaveLength(1)
    expect(harness.trigger).toHaveBeenCalledTimes(1)
    expect(harness.trigger.mock.calls[0]?.[0]?.captchaKey).toContain('/first-body.png')
  })

  it.each(['form', 'image', 'master'])(
    'discovers a captcha completed only by its %s selector attribute',
    async (kind) => {
      const captcha = appendCaptcha()
      const element =
        kind === 'form'
          ? captcha.querySelector('form')
          : kind === 'image'
            ? captcha.querySelector('#riddleimage')
            : captcha
      const attribute = kind === 'form' ? 'name' : 'id'
      const original = element?.getAttribute(attribute)
      expect(original).toBeTruthy()
      element?.removeAttribute(attribute)
      const harness = createHarness()
      apps.push(harness.app)
      harness.app.init()
      await settleDom()
      expect(harness.detector.prepare).not.toHaveBeenCalled()

      element?.setAttribute(attribute, original ?? '')
      await settleDom()

      expect(findCaptchaTarget()).not.toBeNull()
      expect(harness.detector.prepare).toHaveBeenCalledTimes(1)
      expect(harness.trigger).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['form name', 'nested children'] as const)(
    'discovers a later captcha completed by %s behind an incomplete same-ID candidate',
    async (completion) => {
      const incomplete = document.createElement('div')
      incomplete.id = 'riddlemaster'
      document.body.appendChild(incomplete)
      const captcha = appendCaptcha('/later-captcha.png')
      const form = captcha.querySelector('form')!
      const children = Array.from(captcha.childNodes)
      if (completion === 'form name') form.removeAttribute('name')
      else captcha.replaceChildren()
      const harness = createHarness()
      apps.push(harness.app)
      harness.app.init()
      await settleDom()
      expect(harness.trigger).not.toHaveBeenCalled()

      if (completion === 'form name') form.name = 'riddleform'
      else captcha.append(...children)
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(1)
      expect(harness.trigger.mock.calls[0]?.[0]?.master).toBe(captcha)

      form.action = '/next-submit'
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(2)
      expect(harness.trigger.mock.calls[1]?.[0]?.formAction).toBe('http://localhost:3000/next-submit')
    },
  )

  it.each(['form', 'image', 'master'])(
    'cancels preparation immediately when the %s selector disappears',
    async (kind) => {
      const captcha = appendCaptcha()
      const element =
        kind === 'form'
          ? captcha.querySelector('form')
          : kind === 'image'
            ? captcha.querySelector('#riddleimage')
            : captcha
      const attribute = kind === 'form' ? 'name' : 'id'
      const original = element?.getAttribute(attribute)
      const detector = createDetector()
      let finish = () => {}
      vi.mocked(detector.prepare).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }),
      )
      const harness = createHarness({ detector })
      apps.push(harness.app)
      harness.app.init()
      await settleDom()
      const signal = vi.mocked(detector.prepare).mock.calls[0]?.[0]
      expect(signal?.aborted).toBe(false)

      element?.removeAttribute(attribute)
      await Promise.resolve()
      expect(signal?.aborted).toBe(true)
      element?.setAttribute(attribute, original ?? '')
      await settleDom()
      expect(detector.prepare).toHaveBeenCalledTimes(2)
      expect(harness.trigger).toHaveBeenCalledTimes(1)

      finish()
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(1)
    },
  )

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

  it('recovers the next captcha when JPX-style timer cleanup cancels a pending scan', async () => {
    const first = appendCaptcha('/first.png')
    const harness = createHarness()
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    // A late page mutation queues a scan; AJAX round cleanup clears its timer
    // without letting App reset the pending handle.
    first.appendChild(document.createElement('span'))
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(1)
    first.remove()
    vi.clearAllTimers()
    await settleDom()

    const second = appendCaptcha('/second.png')
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)
    expect(harness.trigger.mock.calls[1]?.[0]).toMatchObject({ master: second })

    second.appendChild(document.createElement('span'))
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)
  })

  it('rearms a cleared scan without extending its original deadline under repeated mutations', async () => {
    const harness = createHarness()
    apps.push(harness.app)
    harness.app.init()
    const captcha = appendCaptcha('/ajax.png')
    await Promise.resolve()
    vi.clearAllTimers()

    for (let index = 0; index < 3; index += 1) {
      await vi.advanceTimersByTimeAsync(25)
      captcha.appendChild(document.createElement('span'))
      await Promise.resolve()
    }
    await vi.advanceTimersByTimeAsync(24)
    expect(harness.trigger).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    captcha.appendChild(document.createElement('span'))
    await Promise.resolve()
    harness.app.destroy()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
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

  it('preserves a manual cancellation when an enabled submit button retries previous automatic answers', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const captcha = appendCaptcha('/retry-selection.png')
    const answers = Array.from(captcha.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]'))
    const button = captcha.submitButton
    button.disabled = true
    const buttonClick = vi.spyOn(button, 'click')
    const panel = createPanel()
    const detector = createDetector()
    vi.mocked(detector.detect).mockResolvedValue({
      success: true,
      ponies: ['TS', 'RA'],
      confidences: { TS: 0.9, RA: 0.8 },
      detections: [],
      candidates: [],
    })
    const solver = new CaptchaSolver(
      panel,
      detector,
      { get: async () => new Blob(['captcha']) },
      new AnswerSubmitter(
        async () => [0, 0],
        async () => [100, 100],
      ),
      async () => 'auto',
    )
    const { app } = createHarness({ panel, detector, solver })
    apps.push(app)
    app.init()
    await settleDom()

    expect(detector.detect).toHaveBeenCalledTimes(1)
    expect(panel.addError).toHaveBeenCalledWith('提交按钮不可用', expect.any(Number))
    expect(buttonClick).not.toHaveBeenCalled()
    expect(answers[1]?.checked).toBe(true)

    button.disabled = false
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(100)
    expect(detector.detect).toHaveBeenCalledTimes(2)
    answers[1]?.click()
    expect(answers[1]?.checked).toBe(false)
    await settleDom()

    expect(answers[1]?.checked).toBe(false)
    expect(buttonClick).toHaveBeenCalledTimes(1)
    expect(panel.addSuccess).toHaveBeenCalledTimes(1)

    captcha.appendChild(document.createElement('span'))
    await settleDom()
    expect(detector.detect).toHaveBeenCalledTimes(2)
    expect(buttonClick).toHaveBeenCalledTimes(1)
  })

  it.each(['model preparation', 'image loading', 'inference'] as const)(
    'preserves a manual cancellation during %s and resets that protection for the next captcha',
    async (stage) => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99)
      const captcha = appendCaptcha('/retry-recognition.png')
      const answers = Array.from(captcha.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]'))
      const button = captcha.submitButton
      button.disabled = true
      const buttonClick = vi.spyOn(button, 'click')
      const panel = createPanel()
      const detector = createDetector()
      const detection: YoloParseResult = {
        success: true,
        ponies: ['TS', 'RA'],
        confidences: { TS: 0.9, RA: 0.8 },
        detections: [],
        candidates: [],
      }
      let pauseNextRound = false
      let releaseStage: (() => void) | undefined
      const pauseStage = (): Promise<void> =>
        new Promise((resolve) => {
          releaseStage = resolve
        })
      vi.mocked(detector.prepare).mockImplementation(async () => {
        if (pauseNextRound && stage === 'model preparation') await pauseStage()
      })
      vi.mocked(detector.detect).mockImplementation(async () => {
        if (pauseNextRound && stage === 'inference') await pauseStage()
        return detection
      })
      const solver = new CaptchaSolver(
        panel,
        detector,
        {
          get: async () => {
            if (pauseNextRound && stage === 'image loading') await pauseStage()
            return new Blob(['captcha'])
          },
        },
        new AnswerSubmitter(
          async () => [0, 0],
          async () => [0, 0],
        ),
        async () => 'auto',
      )
      const { app } = createHarness({ panel, detector, solver })
      apps.push(app)
      app.init()
      await settleDom()
      expect(panel.addError).toHaveBeenCalledWith('提交按钮不可用', expect.any(Number))
      expect(answers[1]?.checked).toBe(true)
      expect(buttonClick).not.toHaveBeenCalled()

      pauseNextRound = true
      button.disabled = false
      await settleDom()
      expect(releaseStage).toBeTypeOf('function')
      answers[1]?.click()
      expect(answers[1]?.checked).toBe(false)
      pauseNextRound = false
      releaseStage?.()
      await settleDom()

      expect(answers[1]?.checked).toBe(false)
      expect(buttonClick).toHaveBeenCalledTimes(1)
      expect(panel.addSuccess).toHaveBeenCalledTimes(1)
      expect(detector.detect).toHaveBeenCalledTimes(2)

      captcha.querySelector('img')!.src = '/next-recognition.png'
      await settleDom()
      expect(answers[1]?.checked).toBe(true)
      expect(buttonClick).toHaveBeenCalledTimes(2)
      expect(detector.detect).toHaveBeenCalledTimes(3)
    },
  )

  it.each(['before replacement', 'after replacement'] as const)(
    'observes a new body whose captcha is inserted %s without repeating a handled target',
    async (insertion) => {
      const original = appendCaptcha('/before-body.png')
      const next = original.cloneNode(true) as HTMLDivElement
      const nextImage = next.querySelector('img')!
      nextImage.src = '/after-body.png'
      const harness = createHarness()
      apps.push(harness.app)
      harness.app.init()
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(1)

      const body = document.createElement('body')
      if (insertion === 'before replacement') body.appendChild(next)
      document.body.replaceWith(body)
      await settleDom()
      if (insertion === 'after replacement') body.appendChild(next)
      await settleDom()

      expect(harness.trigger).toHaveBeenCalledTimes(2)
      expect(harness.trigger.mock.calls[1]?.[0]?.master).toBe(next)
      next.appendChild(document.createElement('span'))
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(2)

      nextImage.src = '/next-body-captcha.png'
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(3)
    },
  )

  it('abandons pending work when body is removed and resumes in the replacement body', async () => {
    appendCaptcha('/old-body.png')
    const harness = createHarness()
    let resolvePrepare: (() => void) | undefined
    vi.mocked(harness.detector.prepare).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePrepare = resolve
      }),
    )
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)

    const oldSignal = harness.app.getAbortSignal()
    document.body.remove()
    await settleDom()
    expect(oldSignal?.aborted).toBe(true)
    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)
    document.documentElement.appendChild(document.createElement('body'))
    const next = appendCaptcha('/replacement-body.png')
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)
    resolvePrepare?.()
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
    expect(harness.trigger).toHaveBeenCalledTimes(1)
    expect(harness.trigger.mock.calls[0]?.[0]?.master).toBe(next)
  })

  it('cancels a queued replacement-body scan and ignores further body changes after destroy', async () => {
    const harness = createHarness()
    apps.push(harness.app)
    harness.app.init()
    document.body.replaceWith(document.createElement('body'))
    appendCaptcha('/queued-body.png')
    await Promise.resolve()
    harness.app.destroy()
    await settleDom()

    document.body.replaceWith(document.createElement('body'))
    appendCaptcha('/destroyed-body.png')
    await settleDom()
    expect(harness.detector.prepare).not.toHaveBeenCalled()
    expect(harness.trigger).not.toHaveBeenCalled()
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

  it.each([
    { stage: 'preparation', clockShift: -86_400_000 },
    { stage: 'preparation', clockShift: 86_400_000 },
    { stage: 'solving', clockShift: -86_400_000 },
    { stage: 'solving', clockShift: 86_400_000 },
  ] as const)(
    'keeps the $stage cooldown monotonic when the wall clock shifts by $clockShift ms',
    async ({ stage, clockShift }) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
      const captcha = appendCaptcha('/cooldown.png')
      const click = vi.spyOn(captcha.submitButton, 'click').mockImplementation(() => undefined)
      const panel = createPanel()
      const detector = createDetector()
      const detection: YoloParseResult = {
        success: true,
        ponies: ['TS'],
        confidences: { TS: 0.9 },
        detections: [],
        candidates: [],
      }
      vi.mocked(detector.detect).mockResolvedValue(detection)
      const failingOperation = stage === 'preparation' ? detector.prepare : detector.detect
      vi.mocked(failingOperation).mockRejectedValue(new Error('temporary host failure'))
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
      const { app } = createHarness({ panel, detector, solver })
      apps.push(app)
      app.init()
      await settleDom()
      expect(failingOperation).toHaveBeenCalledTimes(3)
      expect(click).not.toHaveBeenCalled()
      const suppressedAt = performance.now()
      const errors = vi.mocked(panel.addError).mock.calls.length

      vi.setSystemTime(Date.now() + clockShift)
      captcha.appendChild(document.createElement('span'))
      await settleDom()
      expect(failingOperation).toHaveBeenCalledTimes(3)
      expect(panel.addError).toHaveBeenCalledTimes(errors)

      await vi.advanceTimersByTimeAsync(29_799)
      captcha.appendChild(document.createElement('span'))
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      expect(performance.now() - suppressedAt).toBe(29_999)
      expect(failingOperation).toHaveBeenCalledTimes(3)
      expect(click).not.toHaveBeenCalled()

      vi.mocked(detector.prepare).mockResolvedValue(undefined)
      vi.mocked(detector.detect).mockResolvedValue(detection)
      await vi.advanceTimersByTimeAsync(901)
      captcha.appendChild(document.createElement('strong'))
      await settleDom()
      expect(performance.now() - suppressedAt).toBe(31_000)
      expect(failingOperation).toHaveBeenCalledTimes(4)
      expect(click).toHaveBeenCalledTimes(1)
      expect(panel.addSuccess).toHaveBeenCalledTimes(1)
      expect(panel.addError).toHaveBeenCalledTimes(errors)

      captcha.appendChild(document.createElement('span'))
      await settleDom()
      expect(failingOperation).toHaveBeenCalledTimes(4)
      expect(click).toHaveBeenCalledTimes(1)
    },
  )

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
    const firstResult = new Promise<SolveResult>((resolve) => {
      resolveFirst = () => resolve({ handled: false, captchaKey: 'http://localhost:3000/captcha.png', failure: null })
    })
    const harness = createHarness()
    harness.trigger.mockReturnValueOnce(firstResult).mockImplementation(async (target?: CaptchaTarget) => ({
      handled: true,
      captchaKey: target?.captchaKey ?? null,
      failure: null,
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

  it('cancels an active submit delay when a new target arrives and records only the new result', async () => {
    const captcha = appendCaptcha('/old-submit.png')
    const image = captcha.querySelector('img')
    if (!image) throw new Error('captcha image missing')
    const click = vi.spyOn(captcha.submitButton, 'click').mockImplementation(() => undefined)
    const panel = createPanel()
    const detector = createDetector()
    vi.mocked(detector.detect).mockResolvedValue({
      success: true,
      ponies: ['TS'],
      confidences: { TS: 0.9 },
      detections: [],
      candidates: [],
    })
    const submitDelay = vi
      .fn(async (): Promise<readonly [number, number]> => [0, 0])
      .mockResolvedValueOnce([10_000, 10_000])
    const solver = new CaptchaSolver(
      panel,
      detector,
      { get: async () => new Blob(['captcha']) },
      new AnswerSubmitter(submitDelay, async () => [0, 0]),
      async () => 'auto',
    )
    const { app } = createHarness({ panel, detector, solver })
    apps.push(app)
    app.init()
    await vi.advanceTimersByTimeAsync(100)
    expect(submitDelay).toHaveBeenCalledTimes(1)
    expect(click).not.toHaveBeenCalled()
    const oldSignal = app.getAbortSignal()

    image.src = '/new-submit.png'
    await vi.advanceTimersByTimeAsync(101)
    expect(oldSignal?.aborted).toBe(true)
    expect(detector.detect).toHaveBeenCalledTimes(2)
    expect(click).toHaveBeenCalledTimes(1)
    expect(panel.addSuccess).toHaveBeenCalledTimes(1)
    expect(panel.addError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(click).toHaveBeenCalledTimes(1)
    expect(panel.addSuccess).toHaveBeenCalledTimes(1)
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

  it.each(['answer mode', 'submit delay', 'multi-click delay'] as const)(
    'releases a canceled pending %s read so the newest target can finish',
    async (stage) => {
      const captcha = appendCaptcha('/old-settings.png')
      const image = captcha.querySelector('img')!
      const click = vi.spyOn(captcha.submitButton, 'click').mockImplementation(() => undefined)
      const panel = createPanel()
      const detector = createDetector()
      vi.mocked(detector.detect).mockResolvedValue({
        success: true,
        ponies: ['RA'],
        confidences: { RA: 0.9 },
        detections: [],
        candidates: [],
      })
      let rejectOld: ((error: Error) => void) | undefined
      const pending = new Promise<never>((_resolve, reject) => {
        rejectOld = reject
      })
      const mode = vi.fn(async (): Promise<'auto'> => 'auto')
      const submitDelay = vi.fn(async (): Promise<readonly [number, number]> => [0, 0])
      const multiDelay = vi.fn(async (): Promise<readonly [number, number]> => [0, 0])
      if (stage === 'answer mode') mode.mockReturnValueOnce(pending)
      else if (stage === 'submit delay') submitDelay.mockReturnValueOnce(pending)
      else multiDelay.mockReturnValueOnce(pending)
      const solver = new CaptchaSolver(
        panel,
        detector,
        { get: async () => new Blob(['captcha']) },
        new AnswerSubmitter(submitDelay, multiDelay),
        mode,
      )
      const { app } = createHarness({ panel, detector, solver })
      apps.push(app)
      app.init()
      await vi.advanceTimersByTimeAsync(100)
      expect(solver.isBusy).toBe(true)
      const previousSignal = app.getAbortSignal()
      image.src = '/new-settings.png'
      await vi.advanceTimersByTimeAsync(101)
      expect(previousSignal?.aborted).toBe(true)
      expect(solver.isBusy).toBe(false)
      expect(detector.detect).toHaveBeenCalledTimes(2)
      expect(click).toHaveBeenCalledTimes(1)
      expect(panel.addSuccess).toHaveBeenCalledTimes(1)
      rejectOld?.(new Error('late settings rejection'))
      await settleDom()
      expect(click).toHaveBeenCalledTimes(1)
      expect(panel.addError).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it.each(['answer mode', 'submit delay'] as const)('bounds a stalled %s read without submitting', async (stage) => {
    const captcha = appendCaptcha('/stalled-settings.png')
    const click = vi.spyOn(captcha.submitButton, 'click').mockImplementation(() => undefined)
    const panel = createPanel()
    const detector = createDetector()
    vi.mocked(detector.detect).mockResolvedValue({
      success: true,
      ponies: ['RA'],
      confidences: { RA: 0.9 },
      detections: [],
      candidates: [],
    })
    const pending = new Promise<never>(() => undefined)
    const solver = new CaptchaSolver(
      panel,
      detector,
      { get: async () => new Blob(['captcha']) },
      new AnswerSubmitter(
        () => (stage === 'submit delay' ? pending : Promise.resolve([0, 0])),
        async () => [0, 0],
      ),
      () => (stage === 'answer mode' ? pending : Promise.resolve('auto')),
    )
    const { app } = createHarness({ panel, detector, solver })
    apps.push(app)
    app.init()
    await vi.advanceTimersByTimeAsync(100 + inferenceTimeoutConfig.settingsReadTimeoutMs)
    expect(solver.isBusy).toBe(false)
    expect(click).not.toHaveBeenCalled()
    expect(panel.addError).toHaveBeenCalledWith(expect.stringContaining('读取答题设置超时'), expect.any(Number))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not accept a solve completed after a URL-only navigation and rescans the current target', async () => {
    const { promise: firstResult, resolve: resolveFirst } = Promise.withResolvers<SolveResult>()
    const harness = createHarness()
    harness.trigger.mockReturnValueOnce(firstResult)
    apps.push(harness.app)
    harness.app.init()
    const captcha = appendCaptcha('/captcha.png')
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    history.replaceState(null, '', '/next')
    resolveFirst({ handled: true, captchaKey: 'http://localhost:3000/captcha.png', failure: null })
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)
    expect(harness.trigger.mock.calls[1]?.[0]?.pageUrl).toBe('http://localhost:3000/next')

    captcha.appendChild(document.createElement('span'))
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)
  })

  it.each([
    'model preparation',
    'image loading',
    'inference',
    'answer mode',
    'submit settings',
    'multi-click settings',
    'submit delay',
  ] as const)('takes over a URL-only navigation after pending %s settles without another mutation', async (stage) => {
    const captcha = appendCaptcha('/url-only.png')
    const submissionUrls: string[] = []
    const click = vi.spyOn(captcha.submitButton, 'click').mockImplementation(() => {
      submissionUrls.push(location.href)
    })
    const panel = createPanel()
    const detector = createDetector()
    const gate = Promise.withResolvers<void>()
    let paused = false
    const pauseStage = async (candidate: string): Promise<void> => {
      if (stage === candidate && !paused) {
        paused = true
        await gate.promise
      }
    }
    vi.mocked(detector.prepare).mockImplementation(async () => pauseStage('model preparation'))
    vi.mocked(detector.detect).mockImplementation(async () => {
      await pauseStage('inference')
      return { success: true, ponies: ['TS'], confidences: { TS: 0.9 }, detections: [], candidates: [] }
    })
    const submitDelay = vi.fn(async (): Promise<readonly [number, number]> => {
      await pauseStage('submit settings')
      return stage === 'submit delay' && submitDelay.mock.calls.length === 1 ? [1_000, 1_000] : [0, 0]
    })
    const solver = new CaptchaSolver(
      panel,
      detector,
      {
        get: async () => {
          await pauseStage('image loading')
          return new Blob(['captcha'])
        },
      },
      new AnswerSubmitter(submitDelay, async () => {
        await pauseStage('multi-click settings')
        return [0, 0]
      }),
      async () => {
        await pauseStage('answer mode')
        return 'auto'
      },
    )
    const { app } = createHarness({ panel, detector, solver })
    apps.push(app)
    app.init()
    await vi.advanceTimersByTimeAsync(100)
    expect(paused || (stage === 'submit delay' && submitDelay.mock.calls.length === 1)).toBe(true)
    expect(click).not.toHaveBeenCalled()
    const oldSignal = app.getAbortSignal()

    history.pushState(null, '', '/next')
    gate.resolve()
    await settleDom()

    expect(oldSignal?.aborted).toBe(true)
    expect(app.getAbortSignal()).not.toBe(oldSignal)
    expect(detector.prepare).toHaveBeenCalledTimes(2)
    expect(detector.detect).toHaveBeenCalledTimes(stage === 'model preparation' || stage === 'image loading' ? 1 : 2)
    expect(submissionUrls).toEqual(['http://localhost:3000/next'])
    expect(click).toHaveBeenCalledTimes(1)
    expect(panel.addSuccess).toHaveBeenCalledTimes(1)
    expect(panel.addError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    captcha.appendChild(document.createElement('span'))
    await settleDom()
    expect(detector.prepare).toHaveBeenCalledTimes(2)
    expect(click).toHaveBeenCalledTimes(1)
    expect(panel.addSuccess).toHaveBeenCalledTimes(1)
  })

  it.each(['load', 'error'])(
    'waits through pending srcset selection, then rescans on %s without another mutation',
    async (eventType) => {
      const removeListener = vi.spyOn(document, 'removeEventListener')
      const captcha = appendCaptcha('/captcha-a.png')
      const image = captcha.querySelector('img')!
      let currentSrc = 'http://localhost:3000/captcha-a.png'
      let complete = true
      Object.defineProperty(image, 'currentSrc', {
        configurable: true,
        get: () => currentSrc,
      })
      Object.defineProperty(image, 'complete', { get: () => complete })
      const harness = createHarness()
      apps.push(harness.app)
      harness.app.init()
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(1)

      image.srcset = '/captcha-b.png 1x'
      currentSrc = ''
      complete = false
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(1)

      currentSrc = 'http://localhost:3000/captcha-b.png'
      complete = true
      image.dispatchEvent(new Event(eventType))
      await settleDom()

      expect(harness.trigger).toHaveBeenCalledTimes(2)
      expect(harness.trigger.mock.calls[1]?.[0]?.captchaKey).toContain('/captcha-b.png')
      harness.app.destroy()
      expect(removeListener).toHaveBeenCalledWith('load', expect.any(Function), true)
      expect(removeListener).toHaveBeenCalledWith('error', expect.any(Function), true)
      currentSrc = 'http://localhost:3000/captcha-c.png'
      image.dispatchEvent(new Event('load'))
      image.dispatchEvent(new Event('error'))
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['image sizes', 'source sizes', 'source media'] as const)(
    'cancels preparation before the scan debounce when %s changes',
    async (change) => {
      const captcha = appendCaptcha('/responsive.png')
      const image = captcha.querySelector('img')!
      const picture = document.createElement('picture')
      const source = document.createElement('source')
      source.srcset = '/responsive.png 1x'
      image.replaceWith(picture)
      picture.append(source, image)
      Object.defineProperties(image, {
        currentSrc: { value: new URL('/responsive.png', location.href).href },
        complete: { value: true },
      })
      const harness = createHarness()
      vi.mocked(harness.detector.prepare).mockReturnValueOnce(new Promise(() => undefined))
      apps.push(harness.app)
      harness.app.init()
      await vi.advanceTimersByTimeAsync(100)
      const previousSignal = harness.app.getAbortSignal()
      if (change === 'image sizes') image.sizes = '100px'
      else if (change === 'source sizes') source.sizes = '100px'
      else source.media = '(min-width: 1px)'
      await Promise.resolve()
      expect(previousSignal?.aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(100)
      expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
      expect(harness.trigger).toHaveBeenCalledTimes(1)
    },
  )

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

  it('cancels preparation before debounce when an outer fieldset disables controls and recovers on enable', async () => {
    const captcha = appendCaptcha('/outer-fieldset.png')
    const fieldset = document.createElement('fieldset')
    fieldset.append(captcha)
    document.body.append(fieldset)
    const harness = createHarness()
    let resolveOld: (() => void) | undefined
    vi.mocked(harness.detector.prepare).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveOld = resolve
      }),
    )
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    const oldSignal = harness.app.getAbortSignal()
    expect(oldSignal?.aborted).toBe(false)

    fieldset.disabled = true
    await Promise.resolve()
    expect(oldSignal?.aborted).toBe(true)
    expect(harness.trigger).not.toHaveBeenCalled()

    fieldset.disabled = false
    await settleDom()
    expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
    expect(harness.trigger).toHaveBeenCalledTimes(1)
    resolveOld?.()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)
  })

  it.each(['answer', 'submit'] as const)(
    'cancels preparation immediately when the %s loses its form owner and recovers after restoration',
    async (kind) => {
      const captcha = appendCaptcha('/form-owner.png')
      const form = captcha.querySelector('form')!
      form.id = 'captcha-form'
      const control = captcha.querySelector<HTMLInputElement>(
        kind === 'answer' ? 'input[name="riddleanswer[]"]' : '#riddlesubmit',
      )!
      const harness = createHarness()
      const oldPreparation = Promise.withResolvers<void>()
      vi.mocked(harness.detector.prepare).mockReturnValueOnce(oldPreparation.promise)
      apps.push(harness.app)
      harness.app.init()
      await settleDom()
      const oldSignal = harness.app.getAbortSignal()

      control.setAttribute('form', form.id)
      await Promise.resolve()
      expect(oldSignal?.aborted).toBe(false)
      control.setAttribute('form', 'missing-form')
      await Promise.resolve()
      expect(oldSignal?.aborted).toBe(true)
      expect(harness.trigger).not.toHaveBeenCalled()

      control.removeAttribute('form')
      await settleDom()
      expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
      expect(harness.trigger).toHaveBeenCalledTimes(1)
      oldPreparation.resolve()
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['answer', 'submit'] as const)(
    'cancels preparation when an external duplicate ID changes the %s form owner',
    async (kind) => {
      const captcha = appendCaptcha('/external-form-owner.png')
      const form = captcha.querySelector('form')!
      form.id = 'captcha-form'
      const control = captcha.querySelector<HTMLInputElement>(
        kind === 'answer' ? 'input[name="riddleanswer[]"]' : '#riddlesubmit',
      )!
      control.setAttribute('form', form.id)
      const harness = createHarness()
      const oldPreparation = Promise.withResolvers<void>()
      vi.mocked(harness.detector.prepare).mockReturnValueOnce(oldPreparation.promise)
      apps.push(harness.app)
      harness.app.init()
      await settleDom()
      const oldSignal = harness.app.getAbortSignal()

      const external = document.createElement(kind === 'answer' ? 'div' : 'form')
      external.id = form.id
      document.body.prepend(external)
      await Promise.resolve()
      expect(control.form).not.toBe(form)
      expect(oldSignal?.aborted).toBe(true)
      expect(harness.trigger).not.toHaveBeenCalled()

      external.id = 'unrelated-form'
      await settleDom()
      expect(control.form).toBe(form)
      expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
      expect(harness.trigger).toHaveBeenCalledTimes(1)
      oldPreparation.resolve()
      external.id = 'still-unrelated-form'
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(1)
    },
  )

  it.each(['answer', 'submit'] as const)(
    'retries a failed captcha when only the %s form association is restored',
    async (kind) => {
      const captcha = appendCaptcha('/restored-form-owner.png')
      const control = captcha.querySelector<HTMLInputElement>(
        kind === 'answer' ? 'input[name="riddleanswer[]"]' : '#riddlesubmit',
      )!
      control.setAttribute('form', 'missing-form')
      const click = vi.spyOn(captcha.submitButton, 'click').mockImplementation(() => undefined)
      const panel = createPanel()
      const detector = createDetector()
      vi.mocked(detector.detect).mockResolvedValue({
        success: true,
        ponies: ['TS'],
        confidences: { TS: 0.9 },
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
      const { app } = createHarness({ panel, detector, solver })
      apps.push(app)
      app.init()
      await settleDom()
      expect(panel.addError).toHaveBeenCalledWith('答案控件不可用', expect.any(Number))
      expect(click).not.toHaveBeenCalled()

      control.removeAttribute('form')
      await settleDom()
      expect(detector.prepare).toHaveBeenCalledTimes(2)
      expect(click).toHaveBeenCalledTimes(1)
      expect(panel.addSuccess).toHaveBeenCalledTimes(1)
      expect(panel.addError).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    { kind: 'answer', recovery: 'removal' },
    { kind: 'submit', recovery: 'removal' },
    { kind: 'answer', recovery: 'rename' },
    { kind: 'submit', recovery: 'rename' },
    { kind: 'answer', recovery: 'reorder' },
    { kind: 'submit', recovery: 'reorder' },
  ] as const)('retries when external $recovery restores the $kind form owner', async ({ kind, recovery }) => {
    const captcha = appendCaptcha('/external-form-recovery.png')
    const form = captcha.querySelector('form')!
    form.id = 'captcha-form'
    const control = captcha.querySelector<HTMLInputElement>(
      kind === 'answer' ? 'input[name="riddleanswer[]"]' : '#riddlesubmit',
    )!
    control.setAttribute('form', form.id)
    const external = document.createElement('div')
    external.id = form.id
    document.body.prepend(external)
    const click = vi.spyOn(captcha.submitButton, 'click').mockImplementation(() => undefined)
    const panel = createPanel()
    const detector = createDetector()
    vi.mocked(detector.detect).mockResolvedValue({
      success: true,
      ponies: ['TS'],
      confidences: { TS: 0.9 },
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
    const { app } = createHarness({ panel, detector, solver })
    apps.push(app)
    app.init()
    await settleDom()
    expect(control.form).toBeNull()
    expect(panel.addError).toHaveBeenCalledWith('答案控件不可用', expect.any(Number))
    expect(click).not.toHaveBeenCalled()

    if (recovery === 'removal') external.remove()
    else if (recovery === 'rename') external.id = 'unrelated-form'
    else document.body.appendChild(external)
    await settleDom()
    expect(control.form).toBe(form)
    expect(detector.prepare).toHaveBeenCalledTimes(2)
    expect(click).toHaveBeenCalledTimes(1)
    expect(panel.addSuccess).toHaveBeenCalledTimes(1)
    expect(panel.addError).toHaveBeenCalledTimes(1)

    external.remove()
    await settleDom()
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('rescans a suppressed initially disabled captcha when only its outer fieldset becomes enabled', async () => {
    const captcha = appendCaptcha('/initially-disabled.png')
    const fieldset = document.createElement('fieldset')
    fieldset.disabled = true
    fieldset.append(captcha)
    document.body.append(fieldset)
    const harness = createHarness()
    harness.trigger.mockImplementation(async (target?: CaptchaTarget) => ({
      handled: !fieldset.disabled,
      captchaKey: target?.captchaKey ?? null,
      failure: fieldset.disabled ? 'transient' : null,
    }))
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    fieldset.disabled = false
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)
  })

  it('recovers a later captcha when its outer fieldset is enabled behind an incomplete same-ID candidate', async () => {
    const incomplete = document.createElement('div')
    incomplete.id = 'riddlemaster'
    document.body.appendChild(incomplete)
    const captcha = appendCaptcha('/later-fieldset.png')
    const fieldset = document.createElement('fieldset')
    fieldset.disabled = true
    fieldset.append(captcha)
    document.body.append(fieldset)
    const harness = createHarness()
    harness.trigger.mockImplementation(async (target?: CaptchaTarget) => ({
      handled: !fieldset.disabled,
      captchaKey: target?.captchaKey ?? null,
      failure: fieldset.disabled ? 'transient' : null,
    }))
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(1)

    fieldset.disabled = false
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)
    expect(harness.trigger.mock.calls[1]?.[0]?.master).toBe(captcha)

    captcha.appendChild(document.createElement('span'))
    await settleDom()
    expect(harness.trigger).toHaveBeenCalledTimes(2)
  })

  it('respects the first legend exception and cancels when an ancestor fieldset gets a new first legend', async () => {
    const captcha = appendCaptcha('/legend.png')
    const fieldset = document.createElement('fieldset')
    const legend = document.createElement('legend')
    legend.append(captcha)
    fieldset.append(legend)
    document.body.append(fieldset)
    const harness = createHarness()
    vi.mocked(harness.detector.prepare).mockReturnValueOnce(new Promise<void>(() => undefined))
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    const signal = harness.app.getAbortSignal()

    fieldset.disabled = true
    await Promise.resolve()
    expect(signal?.aborted).toBe(false)
    const unrelated = document.createElement('fieldset')
    document.body.append(unrelated)
    unrelated.disabled = true
    await Promise.resolve()
    expect(signal?.aborted).toBe(false)

    fieldset.prepend(document.createElement('legend'))
    await Promise.resolve()
    expect(signal?.aborted).toBe(true)
  })

  it('retries a suppressed failed captcha exactly once when its submit button becomes enabled', async () => {
    const captcha = appendCaptcha('/captcha.png')
    const submit = captcha.querySelector<HTMLInputElement>('#riddlesubmit')!
    submit.disabled = true
    const harness = createHarness()
    harness.trigger.mockImplementation(async (target?: CaptchaTarget) => ({
      handled: false,
      captchaKey: target?.captchaKey ?? null,
      failure: 'transient',
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
        return { handled: false, captchaKey: target?.captchaKey ?? null, failure: 'transient' }
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
    await vi.advanceTimersByTimeAsync(31_000)
    captcha.appendChild(document.createElement('span'))
    await settleDom()

    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)
    expect(harness.trigger).not.toHaveBeenCalled()
  })

  it.each(['target', 'committed credentials'] as const)(
    'keeps a real detect permanent failure suppressed until %s changes',
    async (recovery) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
      const captcha = appendCaptcha('/permanent-detect.png')
      captcha.submitButton.disabled = true
      const click = vi.spyOn(captcha.submitButton, 'click').mockImplementation(() => undefined)
      const panel = createPanel()
      const detector = createDetector()
      vi.mocked(detector.detect).mockRejectedValue(new PermanentModelError('模型 Key 无效'))
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
      const { app } = createHarness({ panel, detector, solver })
      apps.push(app)
      app.init()
      await settleDom()
      expect(detector.prepare).toHaveBeenCalledTimes(1)
      expect(detector.detect).toHaveBeenCalledTimes(1)
      expect(panel.addError).toHaveBeenCalledTimes(1)
      expect(click).not.toHaveBeenCalled()

      captcha.submitButton.disabled = false
      await settleDom()
      expect(detector.detect).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(31_000)
      captcha.appendChild(document.createElement('span'))
      await settleDom()
      expect(detector.prepare).toHaveBeenCalledTimes(1)
      expect(detector.detect).toHaveBeenCalledTimes(1)
      expect(panel.addError).toHaveBeenCalledTimes(1)

      vi.mocked(detector.detect).mockResolvedValue({
        success: true,
        ponies: ['TS'],
        confidences: { TS: 0.9 },
        detections: [],
        candidates: [],
      })
      if (recovery === 'target') {
        captcha.querySelector('img')!.src = '/recovered-detect.png'
      } else {
        app.recoverAfterModelCredentialsChanged()
      }
      await settleDom()
      expect(detector.prepare).toHaveBeenCalledTimes(2)
      expect(detector.detect).toHaveBeenCalledTimes(2)
      expect(click).toHaveBeenCalledTimes(1)
      expect(panel.addSuccess).toHaveBeenCalledTimes(1)
      expect(panel.addError).toHaveBeenCalledTimes(1)

      captcha.appendChild(document.createElement('span'))
      await settleDom()
      expect(detector.detect).toHaveBeenCalledTimes(2)
      expect(click).toHaveBeenCalledTimes(1)
    },
  )

  it('keeps a transient prepare failure suppressed through submit readiness until its retry window expires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
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

    await vi.advanceTimersByTimeAsync(30_000)
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

  it.each(['resolve', 'reject'] as const)(
    'cancels stale preparation before debounce and ignores its late %s after the newest target starts',
    async (settlement) => {
      const captcha = appendCaptcha('/captcha-a.png')
      const image = captcha.querySelector('img')
      if (!image) throw new Error('captcha image missing')
      const harness = createHarness()
      let settleOld: (() => void) | undefined
      let resolveNew: (() => void) | undefined
      vi.mocked(harness.detector.prepare)
        .mockReturnValueOnce(
          new Promise<void>((resolve, reject) => {
            settleOld = settlement === 'resolve' ? resolve : () => reject(new Error('late old failure'))
          }),
        )
        .mockReturnValueOnce(
          new Promise<void>((resolve) => {
            resolveNew = resolve
          }),
        )
      apps.push(harness.app)
      harness.app.init()
      await settleDom()
      const oldSignal = harness.app.getAbortSignal()

      // A same-target mutation must not cancel shared preparation.
      captcha.appendChild(document.createElement('span'))
      await settleDom()
      expect(oldSignal?.aborted).toBe(false)
      expect(harness.detector.prepare).toHaveBeenCalledTimes(1)

      image.src = '/captcha-b.png'
      await Promise.resolve()
      expect(oldSignal?.aborted).toBe(true)
      const newSignal = harness.app.getAbortSignal()
      expect(newSignal).not.toBe(oldSignal)
      image.src = '/captcha-c.png'
      await settleDom()
      expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
      expect(newSignal?.aborted).toBe(false)
      expect(harness.trigger).not.toHaveBeenCalled()

      settleOld?.()
      await settleDom()
      expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
      expect(harness.trigger).not.toHaveBeenCalled()
      expect(newSignal?.aborted).toBe(false)
      resolveNew?.()
      await settleDom()
      expect(harness.trigger).toHaveBeenCalledTimes(1)
      expect(harness.trigger.mock.calls[0]?.[0]?.captchaKey).toContain('/captcha-c.png')
    },
  )

  it.each(['controls', 'form action', 'submit action'] as const)(
    'cancels pending preparation when %s changes without changing the image URL',
    async (change) => {
      const captcha = appendCaptcha('/same-image.png')
      const form = captcha.querySelector('form')
      if (!form) throw new Error('captcha form missing')
      if (change === 'submit action') captcha.submitButton.type = 'submit'
      const harness = createHarness()
      vi.mocked(harness.detector.prepare).mockReturnValueOnce(new Promise<void>(() => undefined))
      apps.push(harness.app)
      harness.app.init()
      await settleDom()
      const oldSignal = harness.app.getAbortSignal()
      if (change === 'controls') {
        captcha.replaceWith(appendCaptcha('/same-image.png'))
      } else if (change === 'form action') {
        form.action = '/next-submit'
      } else {
        captcha.submitButton.setAttribute('formaction', '/next-submit')
      }
      await settleDom()
      expect(oldSignal?.aborted).toBe(true)
      expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
      expect(harness.trigger).toHaveBeenCalledTimes(1)
    },
  )

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

  it('does not retry a model GET 403 until credentials change', async () => {
    const captcha = appendCaptcha('/forbidden-model.png')
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 403 }))
    const harness = createHarness()
    vi.mocked(harness.detector.prepare).mockImplementation(async (signal) => {
      await downloadModel(signal, {}, { fetchImpl })
    })
    apps.push(harness.app)
    harness.app.init()
    await settleDom()
    captcha.appendChild(document.createElement('span'))
    await settleDom()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(harness.detector.prepare).toHaveBeenCalledTimes(1)
    expect(harness.trigger).not.toHaveBeenCalled()

    vi.mocked(harness.detector.prepare).mockResolvedValue(undefined)
    harness.app.recoverAfterModelCredentialsChanged()
    await settleDom()
    expect(harness.detector.prepare).toHaveBeenCalledTimes(2)
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
    let resolveFirst: ((result: SolveResult) => void) | undefined
    const firstResult = new Promise<SolveResult>((resolve) => {
      resolveFirst = resolve
    })
    const harness = createHarness()
    harness.trigger.mockReturnValueOnce(firstResult).mockImplementation(async (target?: CaptchaTarget) => ({
      handled: true,
      captchaKey: target?.captchaKey ?? null,
      failure: null,
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

    resolveFirst?.({ handled: true, captchaKey: 'http://localhost:3000/captcha.png', failure: null })
    await settleDom()

    expect(harness.trigger).toHaveBeenCalledTimes(2)
  })

  it('passes the captured solve signal when credentials change between prepare and trigger', async () => {
    const appRef: { current?: App } = {}
    const detector = createDetector()
    const prepareThenable = {
      then(resolve: (value: void) => void): void {
        resolve()
        // Cross the abort-race wrapper, then rotate credentials between prepareTarget and trigger.
        queueMicrotask(() => queueMicrotask(() => appRef.current?.recoverAfterModelCredentialsChanged()))
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
        failure: null,
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
