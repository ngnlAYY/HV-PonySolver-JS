import { ANSWER_CODES } from '@hv-pony-solver/shared/answer'
import type { DetectorService, YoloParseResult } from '../inference/inference-types'
import { isPermanentModelError } from '../model/permanent-model-error'
import type { StatusPanel } from '../status-panel/status-panel-types'
import { sleep } from '../utils/delay'
import { formatErrorMessage } from '../utils/errors'
import { logError } from '../utils/logger'
import type { AnswerMode } from './answer-mode-settings'
import type { AnswerSubmissionService } from './answer-submitter'
import { findCaptchaTarget, isSameCaptchaTarget, type CaptchaTarget } from './captcha-target'
import type { ImageLoader } from './captcha-types'
import { solverConfig } from './solver-config'

const TRANSIENT_RETRY_DELAYS_MS = [250, 750] as const

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

  trigger(target: CaptchaTarget | null = findCaptchaTarget()): Promise<SolveResult> {
    if (this.busy) {
      return Promise.resolve({ handled: false, captchaKey: null })
    }
    this.busy = true
    return this.solve(target).finally(() => {
      this.busy = false
    })
  }

  private async solve(target: CaptchaTarget | null): Promise<SolveResult> {
    const startedAt = Date.now()
    const elapsed = (): number => Date.now() - startedAt
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
    const submitOptions = signal ? { signal, isCurrent } : { isCurrent }

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

      this.panel.setStatus({ inference: `图片获取完成 ${elapsed()}ms` })
      this.panel.setStatus({ inference: '推理请求中' })
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

      const answerMode = await this.getAnswerMode()
      if (!isCurrent()) {
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
            if (!isCurrent()) {
              return
            }
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
          if (!isCurrent()) {
            return
          }
          submitted = true
          this.panel.addRandomFailure(pony, elapsed())
        },
        submitOptions,
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
