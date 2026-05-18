import { ANSWER_CODES } from '@hv-pony-solver/shared'
import type { DetectorService } from '../inference/inference-types'
import type { StatusPanel } from '../status-panel/status-panel-types'
import { formatErrorMessage } from '../utils/errors'
import { logError } from '../utils/logger'
import { AnswerSubmitter } from './answer-submitter'
import type { ImageLoader } from './captcha-types'
import { captchaSelectors } from './captcha-selectors'
import { solverConfig } from './solver-config'

export class CaptchaSolver {
  private busy = false

  constructor(
    private readonly panel: StatusPanel,
    private readonly detector: DetectorService,
    private readonly imageLoader: ImageLoader,
    private readonly answerSubmitter: AnswerSubmitter,
  ) {}

  trigger(): void {
    if (this.busy) {
      return
    }
    this.busy = true
    this.solve().finally(() => {
      this.busy = false
    })
  }

  private async solve(): Promise<void> {
    const startedAt = Date.now()
    const elapsed = (): number => Date.now() - startedAt
    const failSubmit = (message: string): void => {
      this.panel.setStatus({ inference: `错误: ${message}` })
      this.panel.addError(message, elapsed())
    }

    try {
      const form = document.querySelector<HTMLFormElement>(captchaSelectors.form)
      if (!form) {
        failSubmit('未找到答题表单')
        return
      }

      const image = document.querySelector<HTMLImageElement>(captchaSelectors.image)
      if (!image?.src) {
        failSubmit('未找到验证码图片')
        return
      }

      this.panel.setStatus({ inference: '获取图片' })
      const blob = await this.imageLoader.get(image.currentSrc || image.src)
      const result = await this.detector.detect(blob)

      if (result.success && result.ponies.length) {
        await this.answerSubmitter.submit(form, result.ponies, failSubmit, () => {
          this.panel.addSuccess(result.ponies, result.confidences, elapsed())
        })
        return
      }

      if (!solverConfig.randomOnFail) {
        failSubmit('识别失败')
        return
      }

      const pony = ANSWER_CODES[Math.floor(Math.random() * ANSWER_CODES.length)]
      if (!pony) {
        failSubmit('无有效答案')
        return
      }
      await this.answerSubmitter.submit(form, [pony], failSubmit, () => {
        this.panel.addRandomFailure(pony, elapsed())
      })
    } catch (error) {
      const message = formatErrorMessage(error)
      this.panel.setStatus({ inference: `错误: ${message}` })
      this.panel.addError(message, elapsed())
      logError('答题失败:', message)
    }
  }
}
