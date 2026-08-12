import { ANSWER_CODES } from '@hv-pony-solver/shared'
import type { DetectorService, YoloParseResult } from '../inference/inference-types'
import type { StatusPanel } from '../status-panel/status-panel-types'
import { formatErrorMessage } from '../utils/errors'
import { logError } from '../utils/logger'
import type { AnswerMode } from './answer-mode-settings'
import type { AnswerSubmissionService } from './answer-submitter'
import { findCaptchaTarget } from './captcha-target'
import type { ImageLoader } from './captcha-types'
import { solverConfig } from './solver-config'

export type SolveResult = Readonly<{
  handled: boolean
  captchaKey: string | null
}>

export class CaptchaSolver {
  private busy = false

  constructor(
    private readonly panel: StatusPanel,
    private readonly detector: DetectorService,
    private readonly imageLoader: ImageLoader,
    private readonly answerSubmitter: AnswerSubmissionService,
    private readonly getAnswerMode: () => Promise<AnswerMode>,
    private readonly getAbortSignal?: () => AbortSignal | undefined,
    private readonly randomOnFail: boolean = solverConfig.randomOnFail,
  ) {}

  get isBusy(): boolean {
    return this.busy
  }

  trigger(): Promise<SolveResult> {
    if (this.busy) {
      return Promise.resolve({ handled: false, captchaKey: null })
    }
    this.busy = true
    return this.solve().finally(() => {
      this.busy = false
    })
  }

  private async solve(): Promise<SolveResult> {
    const startedAt = Date.now()
    const elapsed = (): number => Date.now() - startedAt
    let captchaKey: string | null = null
    const result = (handled: boolean): SolveResult => ({ handled, captchaKey })
    const failSubmit = (message: string): void => {
      this.panel.setStatus({ inference: `错误: ${message}` })
      this.panel.addError(message, elapsed())
    }
    const signal: AbortSignal | undefined = this.getAbortSignal?.()
    const submitOptions = signal ? { signal } : undefined

    if (signal?.aborted) {
      return result(false)
    }

    try {
      const target = findCaptchaTarget()
      if (!target) {
        failSubmit('未找到验证码')
        return result(false)
      }

      this.panel.setStatus({ inference: '获取图片' })
      captchaKey = target.captchaKey
      let blob: Blob
      try {
        blob = await this.imageLoader.get(captchaKey)
      } catch (error) {
        failSubmit(`图片获取失败: ${formatErrorMessage(error)}`)
        return result(false)
      }

      if (signal?.aborted) {
        return result(false)
      }

      this.panel.setStatus({ inference: `图片获取完成 ${elapsed()}ms` })
      this.panel.setStatus({ inference: '推理请求中' })
      let detectionResult: YoloParseResult
      try {
        detectionResult = await this.detector.detect(blob)
      } catch (error) {
        failSubmit(`推理失败: ${formatErrorMessage(error)}`)
        return result(false)
      }

      if (signal?.aborted) {
        return result(false)
      }

      const answerMode = await this.getAnswerMode()
      if (signal?.aborted) {
        return result(false)
      }

      if (detectionResult.success && detectionResult.ponies.length) {
        if (answerMode === 'manual') {
          this.panel.addManualResult(detectionResult.ponies, detectionResult.confidences, elapsed())
          return result(true)
        }

        let submitted = false
        await this.answerSubmitter.submit(
          target.form,
          detectionResult.ponies,
          failSubmit,
          () => {
            submitted = true
            this.panel.addSuccess(detectionResult.ponies, detectionResult.confidences, elapsed())
          },
          submitOptions,
        )
        return result(submitted)
      }

      if (answerMode === 'manual' || !this.randomOnFail) {
        failSubmit('识别失败: 无可提交答案')
        return result(false)
      }

      const pony = ANSWER_CODES[Math.floor(Math.random() * ANSWER_CODES.length)]
      if (!pony) {
        failSubmit('无有效答案')
        return result(false)
      }
      let submitted = false
      await this.answerSubmitter.submit(
        target.form,
        [pony],
        failSubmit,
        () => {
          submitted = true
          this.panel.addRandomFailure(pony, elapsed())
        },
        submitOptions,
      )
      return result(submitted)
    } catch (error) {
      const message = `答题异常: ${formatErrorMessage(error)}`
      this.panel.setStatus({ inference: `错误: ${message}` })
      this.panel.addError(message, elapsed())
      logError('答题失败:', message)
      return result(false)
    }
  }
}
