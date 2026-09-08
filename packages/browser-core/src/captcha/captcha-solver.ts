import { ANSWER_CODES } from '@hv-pony-solver/shared/answer'
import type { DetectorService, YoloParseResult } from '../inference/inference-types'
import { isPermanentModelError } from '../model/permanent-model-error'
import type { StatusPanel } from '../status-panel/status-panel-types'
import { sleep } from '../utils/delay'
import { formatErrorMessage } from '../utils/errors'
import { logError } from '../utils/logger'
import type { AnswerMode } from './answer-mode-settings'
import type { AnswerSubmissionService, SubmitOptions } from './answer-submitter'
import { findCaptchaTarget, isSameCaptchaTarget, type CaptchaTarget } from './captcha-target'
import type { ImageLoader } from './captcha-types'
import { solverConfig } from './solver-config'

/** Backoff schedule shared by every transient retry loop in the package. */
export const TRANSIENT_RETRY_DELAYS_MS = [250, 750] as const

type RetryOutcome<T> =
  | Readonly<{ state: 'success'; value: T }>
  | Readonly<{ state: 'cancelled' }>
  | Readonly<{ state: 'failed'; error: unknown }>

async function retryTransient<T>(
  operation: () => Promise<T>,
  isCurrent: () => boolean,
  signal?: AbortSignal,
  shouldRetry: (error: unknown) => boolean = () => true,
): Promise<RetryOutcome<T>> {
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
    if (!isCurrent()) {
      return { state: 'cancelled' }
    }
    try {
      const value = await operation()
      return isCurrent() ? { state: 'success', value } : { state: 'cancelled' }
    } catch (error) {
      if (!isCurrent()) {
        return { state: 'cancelled' }
      }
      if (!shouldRetry(error)) {
        return { state: 'failed', error }
      }
      const retryDelay = TRANSIENT_RETRY_DELAYS_MS[attempt]
      if (retryDelay === undefined) {
        return { state: 'failed', error }
      }
      await sleep(retryDelay, signal)
    }
  }
  return { state: 'cancelled' }
}

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

  trigger(target: CaptchaTarget | null = findCaptchaTarget(), startedAt = performance.now()): Promise<SolveResult> {
    if (this.busy) {
      return Promise.resolve({ handled: false, captchaKey: null })
    }
    this.busy = true
    return this.solve(target, startedAt).finally(() => {
      this.busy = false
    })
  }

  private async solve(target: CaptchaTarget | null, startedAt: number): Promise<SolveResult> {
    const elapsed = (): number => Math.round(performance.now() - startedAt)
    let captchaKey: string | null = null
    const result = (handled: boolean): SolveResult => ({ handled, captchaKey })
    const signal: AbortSignal | undefined = this.getAbortSignal?.()
    const isCurrent = (): boolean =>
      signal?.aborted !== true && target !== null && isSameCaptchaTarget(target, findCaptchaTarget())
    const canRecordError = (): boolean =>
      signal?.aborted !== true && (target === null || isSameCaptchaTarget(target, findCaptchaTarget()))
    const failSubmit = (message: string): void => {
      if (!canRecordError()) {
        return
      }
      this.panel.setStatus({ inference: `错误: ${message}` })
      this.panel.addError(message, elapsed())
    }
    const createSubmitOptions = (confidences?: YoloParseResult['confidences']): SubmitOptions => ({
      ...(signal ? { signal } : {}),
      isCurrent,
      ...(confidences ? { confidences } : {}),
    })

    if (signal?.aborted) {
      return result(false)
    }

    try {
      if (!target) {
        failSubmit('未找到验证码')
        return result(false)
      }

      this.panel.setStatus({ inference: '获取图片' })
      captchaKey = target.captchaKey
      const imageStartedAt = performance.now()
      const imageOutcome = await retryTransient(
        () => this.imageLoader.get(target.captchaKey, signal),
        isCurrent,
        signal,
      )
      if (imageOutcome.state === 'cancelled') {
        return result(false)
      }
      if (imageOutcome.state === 'failed') {
        failSubmit(`图片获取失败: ${formatErrorMessage(imageOutcome.error)}`)
        return result(false)
      }
      const blob = imageOutcome.value

      this.panel.setStatus({ inference: `图片获取完成 ${Math.round(performance.now() - imageStartedAt)}ms` })
      this.panel.setStatus({ inference: '推理请求中' })
      const detectionStartedAt = performance.now()
      const detectionOutcome = await retryTransient(
        () => this.detector.detect(blob, signal),
        isCurrent,
        signal,
        // An invalid Key or failed integrity check cannot be fixed by an
        // immediate retry; surface it instead of burning the attempts.
        (error) => !isPermanentModelError(error),
      )
      if (detectionOutcome.state === 'cancelled') {
        return result(false)
      }
      if (detectionOutcome.state === 'failed') {
        failSubmit(`推理失败: ${formatErrorMessage(detectionOutcome.error)}`)
        return result(false)
      }
      const detectionResult: YoloParseResult = detectionOutcome.value
      const detectionElapsed = Math.round(performance.now() - detectionStartedAt)

      const answerMode = await this.getAnswerMode()
      if (!isCurrent()) {
        return result(false)
      }
      // 共用流程在页面侧统计完整识别请求；扩展 Host 不转发推理状态。
      this.panel.setStatus({ inference: `完成 ${detectionElapsed}ms` })

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
            if (!isCurrent()) {
              return
            }
            submitted = true
            this.panel.addSuccess(detectionResult.ponies, detectionResult.confidences, elapsed())
          },
          createSubmitOptions(detectionResult.confidences),
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
          if (!isCurrent()) {
            return
          }
          submitted = true
          this.panel.addRandomFailure(pony, elapsed())
        },
        createSubmitOptions(),
      )
      return result(submitted)
    } catch (error) {
      if (!canRecordError()) {
        return result(false)
      }
      const message = `答题异常: ${formatErrorMessage(error)}`
      this.panel.setStatus({ inference: `错误: ${message}` })
      this.panel.addError(message, elapsed())
      logError('答题失败:', message)
      return result(false)
    }
  }
}
