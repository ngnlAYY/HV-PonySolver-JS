import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AnswerSubmitter } from '../../src/captcha/answer-submitter'
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

function createSolver(overrides: Partial<Readonly<{
  panel: StatusPanel
  detector: DetectorService
  imageLoader: ImageLoader
  answerSubmitter: AnswerSubmitter
}>> = {}): Readonly<{
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
  return {
    solver: new CaptchaSolver(panel, detector, imageLoader, answerSubmitter),
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

  it('reports image loading failures with an image stage prefix', async () => {
    appendCaptcha()
    const { solver, panel, detector, answerSubmitter } = createSolver({
      imageLoader: { get: vi.fn(async () => Promise.reject(new Error('网络断开'))) },
    })

    const result = await solver.trigger()

    expect(result).toEqual({ solved: false, captchaKey: 'http://localhost:3000/captcha.png' })
    expectPanelError(panel, '图片获取失败: Error: 网络断开')
    expect(detector.detect).not.toHaveBeenCalled()
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
  })

  it('reports detector rejections with an inference stage prefix', async () => {
    appendCaptcha()
    const detector = createDetector(vi.fn(async () => Promise.reject('模型离线')))
    const { solver, panel, answerSubmitter } = createSolver({ detector })

    const result = await solver.trigger()

    expect(result).toEqual({ solved: false, captchaKey: 'http://localhost:3000/captcha.png' })
    expectPanelError(panel, '推理失败: 模型离线')
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
  })

  it('reports failed detection results as having no answer to submit', async () => {
    appendCaptcha()
    const detector = createDetector(vi.fn(async () => emptyDetectionResult(false)))
    const { solver, panel, answerSubmitter } = createSolver({ detector })

    const result = await solver.trigger()

    expect(result).toEqual({ solved: false, captchaKey: 'http://localhost:3000/captcha.png' })
    expectPanelError(panel, '识别失败: 无可提交答案')
    expect(answerSubmitter.submit).not.toHaveBeenCalled()
  })

  it('reports empty successful detection results as having no answer to submit', async () => {
    appendCaptcha()
    const detector = createDetector(vi.fn(async () => emptyDetectionResult(true)))
    const { solver, panel, answerSubmitter } = createSolver({ detector })

    const result = await solver.trigger()

    expect(result).toEqual({ solved: false, captchaKey: 'http://localhost:3000/captcha.png' })
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

    expect(result.solved).toBe(false)
    expectPanelError(panel, '答题异常: Error: 面板异常')
  })
})
