import type { DetectorService } from '../inference/inference-types'
import type { StatusPanel } from '../status-panel/status-panel-types'
import type { SolveResult } from '../captcha/captcha-solver'
import type { CaptchaTarget } from '../captcha/captcha-target'
import type { AnswerSelectionSnapshot } from '../captcha/answer-submitter'

export interface SolverService {
  readonly isBusy: boolean
  /** 在模型准备前捕获本轮手动变更身份，并原样传给 trigger。 */
  captureAnswerSelection?(target: CaptchaTarget): AnswerSelectionSnapshot | undefined
  /** startedAt 使用当前页面的 performance.now()，供历史计入模型准备时间。 */
  trigger(
    target?: CaptchaTarget,
    startedAt?: number,
    signal?: AbortSignal,
    answerSelection?: AnswerSelectionSnapshot,
  ): Promise<SolveResult>
}

export type AppDependencies = Readonly<{
  panel: StatusPanel
  detector: DetectorService
  solver: SolverService
  registerSettings?: () => void
  dispose?: () => void
}>
