import {
  CaptchaSolver as CoreCaptchaSolver,
  type AnswerMode,
  type AnswerSubmissionService,
  type DetectorService,
  type ImageLoader,
  type StatusPanelContract,
} from '@hv-pony-solver/browser-core'

import { solverConfig } from './solver-config'

export type { SolveResult } from '@hv-pony-solver/browser-core'

export class CaptchaSolver extends CoreCaptchaSolver {
  constructor(
    panel: StatusPanelContract,
    detector: DetectorService,
    imageLoader: ImageLoader,
    answerSubmitter: AnswerSubmissionService,
    getAnswerMode: () => Promise<AnswerMode>,
    getAbortSignal?: () => AbortSignal | undefined,
    randomOnFail: boolean = solverConfig.randomOnFail,
  ) {
    super(panel, detector, imageLoader, answerSubmitter, getAnswerMode, getAbortSignal, randomOnFail)
  }
}
