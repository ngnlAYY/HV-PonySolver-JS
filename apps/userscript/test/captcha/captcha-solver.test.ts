import { ANSWER_CODES } from '@hv-pony-solver/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnswerSubmitter } from '../../src/captcha/answer-submitter'
import { CaptchaSolver } from '../../src/captcha/captcha-solver'
import type { ImageLoader } from '../../src/captcha/captcha-types'
import type { DetectorService, YoloParseResult } from '../../src/inference/inference-types'
import type { StatusPanel } from '../../src/status-panel/status-panel-types'

function appendCaptcha(): void {
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

function createDetector(detect: DetectorService['detect']): DetectorService {
  return {
    detect,
    prepare: vi.fn(async () => ({}) as Worker),
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
    solver: new CaptchaSolver(panel, detector, imageLoader, answerSubmitter, getAnswerMode, overrides.getAbortSignal),
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

    expect(result).toEqual({ handled: true, captchaKey: 'http://localhost:3000/captcha.png' })
    expect(answerSubmitter.submit).toHaveBeenCalledWith(
      expect.any(HTMLFormElement),
      ['RA'],
      expect.any(Function),
      expect.any(Function),
      undefined,
    )
    expect(panel.addSuccess).toHaveBeenCalledWith(['RA'], { RA: 0.97 }, expect.any(Number))
  })

  it('records detected ponies without submitting in manual mode', async () => {
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
    const { solver, panel, imageLoader, answerSubmitter } = createSolver({
      detector,
      getAnswerMode: vi.fn(async () => 'manual'),
    })

    const result = await solver.trigger()

    expect(result).toEqual({ handled: true, captchaKey: 'http://localhost:3000/captcha.png' })
    expect(imageLoader.get).toHaveBeenCalledWith('http://localhost:3000/captcha.png')
    expect(detector.detect).toHaveBeenCalledTimes(1)
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
    expect(panel.addManualResult).toHaveBeenCalledWith(['RA'], { RA: 0.97 }, expect.any(Number))
    expect(panel.addSuccess).not.toHaveBeenCalled()
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
      getAnswerMode: vi.fn(async () => {
        abortController.abort()
        return 'manual'
      }),
      getAbortSignal: () => abortController.signal,
    })

    const result = await solver.trigger()

    expect(result).toEqual({ handled: false, captchaKey: 'http://localhost:3000/captcha.png' })
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
    expect(panel.addManualResult).not.toHaveBeenCalled()
  })

  it('does not submit when cancellation happens after detection', async () => {
    appendCaptcha()
    const abortController = new AbortController()
    const detector = createDetector(
      vi.fn(async () => {
        abortController.abort()
        return {
          success: true,
          ponies: ['RA'],
          confidences: { RA: 0.97 },
          detections: [],
          candidates: [],
        }
      }),
    )
    const { solver, answerSubmitter } = createSolver({
      detector,
      getAbortSignal: () => abortController.signal,
    })

    const result = await solver.trigger()

    expect(result).toEqual({ handled: false, captchaKey: 'http://localhost:3000/captcha.png' })
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
  })

  it('reports image loading failures with an image stage prefix', async () => {
    appendCaptcha()
    const { solver, panel, detector, answerSubmitter } = createSolver({
      imageLoader: { get: vi.fn(async () => Promise.reject(new Error('网络断开'))) },
    })

    const result = await solver.trigger()

    expect(result).toEqual({ handled: false, captchaKey: 'http://localhost:3000/captcha.png' })
    expectPanelError(panel, '图片获取失败: Error: 网络断开')
    expect(detector.detect).not.toHaveBeenCalled()
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
  })

  it('reports detector rejections with an inference stage prefix', async () => {
    appendCaptcha()
    const detector = createDetector(vi.fn(async () => Promise.reject('模型离线')))
    const { solver, panel, answerSubmitter } = createSolver({ detector })

    const result = await solver.trigger()

    expect(result).toEqual({ handled: false, captchaKey: 'http://localhost:3000/captcha.png' })
    expectPanelError(panel, '推理失败: 模型离线')
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
  })

  it('reports image loading and detector stages before failed detection results', async () => {
    appendCaptcha()
    const detector = createDetector(vi.fn(async () => emptyDetectionResult(false)))
    const { solver, panel, answerSubmitter } = createSolver({ detector })

    const result = await solver.trigger()

    expect(result).toEqual({ handled: false, captchaKey: 'http://localhost:3000/captcha.png' })
    expect(panel.setStatus).toHaveBeenCalledWith({ inference: '获取图片' })
    expect(panel.setStatus).toHaveBeenCalledWith({ inference: expect.stringMatching(/^图片获取完成 \d+ms$/) })
    expect(panel.setStatus).toHaveBeenCalledWith({ inference: '推理请求中' })
    expectPanelError(panel, '识别失败: 无可提交答案')
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
  })

  it('does not report image success after cancellation during image loading', async () => {
    appendCaptcha()
    const abortController = new AbortController()
    const detector = createDetector(vi.fn(async () => emptyDetectionResult(true)))
    const { solver, panel } = createSolver({
      detector,
      getAbortSignal: () => abortController.signal,
      imageLoader: {
        get: vi.fn(async () => {
          abortController.abort()
          return new Blob(['captcha'])
        }),
      },
    })

    const result = await solver.trigger()

    expect(result).toEqual({ handled: false, captchaKey: 'http://localhost:3000/captcha.png' })
    expect(panel.setStatus).toHaveBeenCalledWith({ inference: '获取图片' })
    expect(panel.setStatus).not.toHaveBeenCalledWith({ inference: expect.stringMatching(/^图片获取完成 \d+ms$/) })
    expect(detector.detect).not.toHaveBeenCalled()
  })

  it('reports empty successful detection results as having no answer to submit', async () => {
    appendCaptcha()
    const detector = createDetector(vi.fn(async () => emptyDetectionResult(true)))
    const { solver, panel, answerSubmitter } = createSolver({ detector })

    const result = await solver.trigger()

    expect(result).toEqual({ handled: false, captchaKey: 'http://localhost:3000/captcha.png' })
    expectPanelError(panel, '识别失败: 无可提交答案')
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
  })

  it('reports unexpected non-stage exceptions with an answer exception prefix', async () => {
    appendCaptcha()
    const panel = createPanel()
    vi.mocked(panel.setStatus).mockImplementation((changes) => {
      if (changes.inference === '获取图片') {
        throw new Error('面板异常')
      }
    })
    const { solver } = createSolver({ panel })

    const result = await solver.trigger()

    expect(result.handled).toBe(false)
    expectPanelError(panel, '答题异常: Error: 面板异常')
  })
})

describe('CaptchaSolver random fallback', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('does not use the random fallback in manual mode', async () => {
    vi.resetModules()
    vi.doMock('../../src/captcha/solver-config', () => ({ solverConfig: { randomOnFail: true } }))
    try {
      const { CaptchaSolver: RandomCaptchaSolver } = await import('../../src/captcha/captcha-solver')
      appendCaptcha()
      const panel = createPanel()
      const detector = createDetector(vi.fn(async () => emptyDetectionResult(false)))
      const imageLoader = { get: vi.fn(async () => new Blob(['captcha'])) }
      const answerSubmitter = createAnswerSubmitter()
      const solver = new RandomCaptchaSolver(panel, detector, imageLoader, answerSubmitter, async () => 'manual')

      const result = await solver.trigger()

      expect(result).toEqual({ handled: false, captchaKey: 'http://localhost:3000/captcha.png' })
      expect(answerSubmitter.submit).not.toHaveBeenCalled()
      expect(panel.addRandomFailure).not.toHaveBeenCalled()
      expectPanelError(panel, '识别失败: 无可提交答案')
    } finally {
      vi.doUnmock('../../src/captcha/solver-config')
    }
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

      expect(result).toEqual({ handled: true, captchaKey: 'http://localhost:3000/captcha.png' })
      expect(panel.addRandomFailure).toHaveBeenCalledWith(submittedPony, expect.any(Number))
    } finally {
      vi.doUnmock('../../src/captcha/solver-config')
    }
  })
})
