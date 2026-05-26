import { ANSWER_CODES } from '@hv-pony-solver/shared'
import type { DetectorService } from '../inference/inference-types'
import type { StatusPanel } from '../status-panel/status-panel-types'
import { formatErrorMessage } from '../utils/errors'
import { logError } from '../utils/logger'
import { AnswerSubmitter } from './answer-submitter'
import { findCaptchaTarget } from './captcha-target'
import type { ImageLoader } from './captcha-types'
import { solverConfig } from './solver-config'

export type SolveResult = Readonly<{
  solved: boolean
  captchaKey: string | null
}>

export class CaptchaSolver {
  private busy = false

  constructor(
    private readonly panel: StatusPanel,
    private readonly detector: DetectorService,
    private readonly imageLoader: ImageLoader,
    private readonly answerSubmitter: AnswerSubmitter,
    private readonly getAbortSignal?: () => AbortSignal | undefined,
  ) {}

  get isBusy(): boolean {
    return this.busy
  }

  trigger(): Promise<SolveResult> {
    if (this.busy) {
      return Promise.resolve({ solved: false, captchaKey: null })
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
    const result = (solved: boolean): SolveResult => ({ solved, captchaKey })
    const failSubmit = (message: string): void => {
      this.panel.setStatus({ inference: `错误: ${message}` })
      this.panel.addError(message, elapsed())
    }
    const signal: AbortSignal | undefined = this.getAbortSignal?.()
    const submitOptions = signal ? { signal } : undefined

    // 进入 try 前检查 abort
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
      const blob = await this.imageLoader.get(captchaKey)

      // imageLoader.get 之后检查 abort
      if (signal?.aborted) {
        return result(false)
      }

      const detectionResult = await this.detector.detect(blob)

      // detector.detect 之后检查 abort
      if (signal?.aborted) {
        return result(false)
      }

      if (detectionResult.success && detectionResult.ponies.length) {
        let submitted = false
        await this.answerSubmitter.submit(target.form, detectionResult.ponies, failSubmit, () => {
          submitted = true
          this.panel.addSuccess(detectionResult.ponies, detectionResult.confidences, elapsed())
        }, submitOptions)
        return result(submitted)
      }

      if (!solverConfig.randomOnFail) {
        failSubmit('识别失败')
        return result(false)
      }

      const pony = ANSWER_CODES[Math.floor(Math.random() * ANSWER_CODES.length)]
      if (!pony) {
        failSubmit('无有效答案')
        return result(false)
      }
      let submitted = false
      await this.answerSubmitter.submit(target.form, [pony], failSubmit, () => {
        submitted = true
        this.panel.addRandomFailure(pony, elapsed())
      }, submitOptions)
      return result(submitted)
    } catch (error) {
      const message = formatErrorMessage(error)
      this.panel.setStatus({ inference: `错误: ${message}` })
      this.panel.addError(message, elapsed())
      logError('答题失败:', message)
      return result(false)
    }
  }
}
