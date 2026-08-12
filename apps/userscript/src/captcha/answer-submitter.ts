import { AnswerSubmitter as CoreAnswerSubmitter } from '@hv-pony-solver/browser-core'

import { getMultiClickDelayRange, getSubmitDelayRange } from './timing-settings'

export type {
  AnswerSubmissionService,
  DelayRangeProvider,
  SubmitErrorHandler,
  SubmitOptions,
} from '@hv-pony-solver/browser-core'

export class AnswerSubmitter extends CoreAnswerSubmitter {
  constructor() {
    super(getSubmitDelayRange, getMultiClickDelayRange)
  }
}
