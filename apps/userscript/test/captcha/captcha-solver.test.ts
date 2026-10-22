// @vitest-environment jsdom

import { ANSWER_CODES } from '@hv-pony-solver/shared'
import type {
  DetectorService,
  ImageLoader,
  StatusPanelContract as StatusPanel,
  YoloParseResult,
} from '@hv-pony-solver/browser-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnswerSubmitter } from '../../src/captcha/answer-submitter'
import { CaptchaSolver } from '../../src/captcha/captcha-solver'

function appendCaptcha(): HTMLDivElement {
  document.body.innerHTML = ''
  const master = document.createElement('div')
  master.id = 'riddlemaster'
  const form = document.createElement('form')
  form.name = 'riddleform'
  const imageContainer = document.createElement('div')
  imageContainer.id = 'riddleimage'
  const image = document.createElement('img')
  image.src = '/captcha.png'
  imageContainer.appendChild(image)
  master.append(form, imageContainer)
  document.body.appendChild(master)
  return master
}

function createPanel(): StatusPanel {
  return {
    setStatus: vi.fn(),
    setSessionReady: vi.fn(),
    addSuccess: vi.fn(),
    addManualResult: vi.fn(),
    addRandomFailure: vi.fn(),
    addError: vi.fn(),
    create: vi.fn(),
    destroy: vi.fn(),
  }
}

function createDetector(detect: (...args: Parameters<DetectorService['detect']>) => Promise<object>): DetectorService {
  return {
    // SAFETY: These test-only mocks return controlled detector-shaped objects;
    // production responses are validated by the detector implementation.
    detect: detect as unknown as DetectorService['detect'],
    prepare: vi.fn(async () => undefined),
    destroy: vi.fn(),
  }
}

function createAnswerSubmitter(): AnswerSubmitter {
  return {
    submit: vi.fn(async () => undefined),
  } as unknown as AnswerSubmitter
}

function emptyDetectionResult(success: boolean): YoloParseResult {
  return {
    success,
    ponies: [],
    confidences: {},
    detections: [],
    candidates: [],
  }
}

function createSolver(
  overrides: Partial<
    Readonly<{
      panel: StatusPanel
      detector: DetectorService
      imageLoader: ImageLoader
      answerSubmitter: AnswerSubmitter
      getAnswerMode: () => Promise<'auto' | 'manual'>
      getAbortSignal: () => AbortSignal | undefined
      randomOnFail: boolean
    }>
  > = {},
): Readonly<{
  solver: CaptchaSolver
  panel: StatusPanel
  detector: DetectorService
  imageLoader: ImageLoader
  answerSubmitter: AnswerSubmitter
}> {
  const panel = overrides.panel ?? createPanel()
  const detector = overrides.detector ?? createDetector(vi.fn(async () => emptyDetectionResult(false)))
  const imageLoader = overrides.imageLoader ?? { get: vi.fn(async () => new Blob(['captcha'])) }
  const answerSubmitter = overrides.answerSubmitter ?? createAnswerSubmitter()
  const getAnswerMode = overrides.getAnswerMode ?? vi.fn(async () => 'auto' as const)
  return {
    solver: new CaptchaSolver(
      panel,
      detector,
      imageLoader,
      answerSubmitter,
      getAnswerMode,
      overrides.getAbortSignal,
      overrides.randomOnFail,
    ),
    panel,
    detector,
    imageLoader,
    answerSubmitter,
  }
}

function expectPanelError(panel: StatusPanel, message: string): void {
  expect(panel.setStatus).toHaveBeenCalledWith({ inference: `错误: ${message}` })
  expect(panel.addError).toHaveBeenCalledWith(message, expect.any(Number))
}

describe('CaptchaSolver', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('submits detected ponies and records success', async () => {
    appendCaptcha()
    const detector = createDetector(
      vi.fn(async () => ({
        success: true,
        ponies: ['RA'],
        confidences: { RA: 0.97 },
        detections: [],
        candidates: [],
      })),
    )
    const { solver, panel, answerSubmitter } = createSolver({ detector })

    vi.mocked(answerSubmitter.submit).mockImplementation(async (_form, _ponies, _onError, onSubmitted) => {
      onSubmitted()
    })

    const result = await solver.trigger()

    expect(result).toEqual({ handled: true, captchaKey: 'http://localhost:3000/captcha.png', failure: null })
    expect(answerSubmitter.submit).toHaveBeenCalledWith(
      expect.any(HTMLFormElement),
      ['RA'],
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ isCurrent: expect.any(Function) }),
    )
    expect(panel.addSuccess).toHaveBeenCalledWith(['RA'], { RA: 0.97 }, expect.any(Number))
  })

  it('does not record or submit when cancellation happens while answer mode is loading', async () => {
    appendCaptcha()
    const abortController = new AbortController()
    const detector = createDetector(
      vi.fn(async () => ({
        success: true,
        ponies: ['RA'],
        confidences: { RA: 0.97 },
        detections: [],
        candidates: [],
      })),
    )
    const { solver, panel, answerSubmitter } = createSolver({
      detector,
      getAnswerMode: async () => {
        abortController.abort()
        return 'manual'
      },
      getAbortSignal: () => abortController.signal,
    })

    const result = await solver.trigger()

    expect(result).toEqual({ handled: false, captchaKey: 'http://localhost:3000/captcha.png', failure: null })
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
    expect(panel.addManualResult).not.toHaveBeenCalled()
  })

  it('reports image loading and detector stages before failed detection results', async () => {
    appendCaptcha()
    const detector = createDetector(vi.fn(async () => emptyDetectionResult(false)))
    const { solver, panel, answerSubmitter } = createSolver({ detector, randomOnFail: false })

    const result = await solver.trigger()

    expect(result).toEqual({ handled: false, captchaKey: 'http://localhost:3000/captcha.png', failure: 'transient' })
    expect(panel.setStatus).toHaveBeenCalledWith({ inference: '获取图片' })
    expect(panel.setStatus).toHaveBeenCalledWith({ inference: expect.stringMatching(/^图片获取完成 \d+ms$/) })
    expect(panel.setStatus).toHaveBeenCalledWith({ inference: '推理请求中' })
    expectPanelError(panel, '识别失败: 无可提交答案')
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
  })
})

describe('CaptchaSolver random fallback', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('submits a random pony when randomOnFail is enabled', async () => {
    vi.resetModules()
    vi.doMock('../../src/captcha/solver-config', () => ({ solverConfig: { randomOnFail: true } }))
    try {
      const { CaptchaSolver: RandomCaptchaSolver } = await import('../../src/captcha/captcha-solver')
      appendCaptcha()
      const panel = createPanel()
      const detector = createDetector(vi.fn(async () => emptyDetectionResult(false)))
      const imageLoader = { get: vi.fn(async () => new Blob(['captcha'])) }
      const answerSubmitter = createAnswerSubmitter()
      let submittedPony: string | undefined
      vi.mocked(answerSubmitter.submit).mockImplementation(async (_form, ponies, _onError, onSubmitted) => {
        expect(ponies).toHaveLength(1)
        submittedPony = ponies[0]
        expect(ANSWER_CODES).toContain(submittedPony)
        onSubmitted()
      })

      const solver = new RandomCaptchaSolver(panel, detector, imageLoader, answerSubmitter, async () => 'auto')
      const result = await solver.trigger()

      expect(result).toEqual({ handled: true, captchaKey: 'http://localhost:3000/captcha.png', failure: null })
      expect(panel.addRandomFailure).toHaveBeenCalledWith(submittedPony, expect.any(Number))
    } finally {
      vi.doUnmock('../../src/captcha/solver-config')
    }
  })
})
