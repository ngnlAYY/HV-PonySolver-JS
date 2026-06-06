import { ANSWER_CODES, type AnswerCode } from '@hv-pony-solver/shared'
import { randDelay, shuffle, sleep } from '../utils/delay'
import { log } from '../utils/logger'
import { captchaSelectors } from './captcha-selectors'
import { timingConfig } from './timing-config'

export type SubmitErrorHandler = (message: string) => void

export type SubmitOptions = {
  signal?: AbortSignal
}

export class AnswerSubmitter {
  async submit(
    form: HTMLFormElement,
    ponies: AnswerCode[],
    onError: SubmitErrorHandler,
    onSubmitted: () => void,
    options?: SubmitOptions,
  ): Promise<void> {
    const signal = options?.signal

    if (signal?.aborted) {
      return
    }

    const checkboxes = form.querySelectorAll<HTMLInputElement>(captchaSelectors.answers)
    if (checkboxes.length !== ANSWER_CODES.length) {
      onError(`答案框数量异常: ${checkboxes.length}`)
      return
    }

    const button = form.querySelector<HTMLInputElement>(captchaSelectors.submit)
    if (!button) {
      onError('未找到提交按钮')
      return
    }

    const indices = ponies.map((pony) => ANSWER_CODES.indexOf(pony)).filter((index) => index >= 0)
    if (!indices.length) {
      onError('无有效答案')
      return
    }

    for (let i = 0; i < checkboxes.length; i += 1) {
      const checkbox = checkboxes.item(i)
      if (checkbox.checked) {
        checkbox.click()
      }
    }

    const order = shuffle(indices)
    for (let i = 0; i < order.length; i += 1) {
      const index = order[i]
      const checkbox = index === undefined ? undefined : checkboxes[index]
      if (!checkbox) {
        continue
      }
      if (!checkbox.checked) {
        checkbox.click()
      }
      if (i < order.length - 1) {
        await sleep(randDelay(timingConfig.multiClickDelay), signal)
        if (signal?.aborted) {
          return
        }
      }
    }

    await sleep(randDelay(timingConfig.submitDelay), signal)
    if (signal?.aborted) {
      return
    }

    button.click()
    onSubmitted()
    log('已提交:', ponies.join(','))
  }
}
