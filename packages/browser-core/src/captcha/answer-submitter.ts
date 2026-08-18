import { ANSWER_CODES, type AnswerCode } from '@hv-pony-solver/shared/answer'
import { randDelay, shuffle, sleep } from '../utils/delay'
import { captchaSelectors } from './captcha-selectors'
import type { DelayRange } from './timing-settings'

export type SubmitErrorHandler = (message: string) => void

export type SubmitOptions = {
  signal?: AbortSignal
  isCurrent?: () => boolean
}

export interface AnswerSubmissionService {
  submit(
    form: HTMLFormElement,
    ponies: AnswerCode[],
    onError: SubmitErrorHandler,
    onSubmitted: () => void,
    options?: SubmitOptions,
  ): Promise<void>
}

export type DelayRangeProvider = () => Promise<DelayRange>

type SubmissionControls = Readonly<{
  checkboxes: readonly HTMLInputElement[]
  button: HTMLInputElement
}>

function readControls(form: HTMLFormElement): Readonly<{
  checkboxes: readonly HTMLInputElement[]
  button: HTMLInputElement | null
}> {
  return {
    checkboxes: Array.from(form.querySelectorAll<HTMLInputElement>(captchaSelectors.answers)),
    button: form.querySelector<HTMLInputElement>(captchaSelectors.submit),
  }
}

function hasSameControls(expected: SubmissionControls, current: SubmissionControls): boolean {
  return (
    expected.button === current.button &&
    expected.checkboxes.length === current.checkboxes.length &&
    expected.checkboxes.every((checkbox, index) => checkbox === current.checkboxes[index])
  )
}

function controlsAreUsable(form: HTMLFormElement, controls: SubmissionControls): boolean {
  return (
    form.isConnected &&
    controls.button.isConnected &&
    controls.button.form === form &&
    !controls.button.disabled &&
    controls.checkboxes.every((checkbox) => checkbox.isConnected && checkbox.form === form && !checkbox.disabled)
  )
}

export class AnswerSubmitter implements AnswerSubmissionService {
  constructor(
    private readonly getSubmitDelayRange: DelayRangeProvider,
    private readonly getMultiClickDelayRange: DelayRangeProvider,
  ) {}

  async submit(
    form: HTMLFormElement,
    ponies: AnswerCode[],
    onError: SubmitErrorHandler,
    onSubmitted: () => void,
    options?: SubmitOptions,
  ): Promise<void> {
    const signal = options?.signal
    const shouldStop = (): boolean => signal?.aborted === true || options?.isCurrent?.() === false

    if (shouldStop()) {
      return
    }

    const initialControls = readControls(form)
    if (initialControls.checkboxes.length !== ANSWER_CODES.length) {
      onError(`答案框数量异常: ${initialControls.checkboxes.length}`)
      return
    }

    if (!initialControls.button) {
      onError('未找到提交按钮')
      return
    }

    const expectedControls: SubmissionControls = {
      checkboxes: initialControls.checkboxes,
      button: initialControls.button,
    }
    if (!controlsAreUsable(form, expectedControls)) {
      onError('答案控件不可用')
      return
    }

    const currentControls = (): SubmissionControls | null => {
      if (shouldStop()) {
        return null
      }
      const current = readControls(form)
      if (current.checkboxes.length !== ANSWER_CODES.length || !current.button) {
        return null
      }
      const controls: SubmissionControls = {
        checkboxes: current.checkboxes,
        button: current.button,
      }
      return hasSameControls(expectedControls, controls) && controlsAreUsable(form, controls) ? controls : null
    }

    const indices = ponies.map((pony) => ANSWER_CODES.indexOf(pony)).filter((index) => index >= 0)
    if (!indices.length) {
      onError('无有效答案')
      return
    }

    for (let i = 0; i < expectedControls.checkboxes.length; i += 1) {
      const controls = currentControls()
      if (!controls) {
        return
      }
      const checkbox = controls.checkboxes[i]
      if (checkbox?.checked) {
        checkbox.click()
      }
    }

    const [submitDelay, multiClickDelay] = await Promise.all([
      this.getSubmitDelayRange(),
      this.getMultiClickDelayRange(),
    ])
    if (!currentControls()) {
      return
    }

    const order = shuffle(indices)
    for (let i = 0; i < order.length; i += 1) {
      const controls = currentControls()
      if (!controls) {
        return
      }
      const index = order[i]
      const checkbox = index === undefined ? undefined : controls.checkboxes[index]
      if (!checkbox) {
        continue
      }
      if (!checkbox.checked) {
        checkbox.click()
      }
      if (i < order.length - 1) {
        await sleep(randDelay(multiClickDelay), signal)
        if (!currentControls()) {
          return
        }
      }
    }

    await sleep(randDelay(submitDelay), signal)
    const controls = currentControls()
    if (!controls) {
      return
    }

    controls.button.click()
    if (!shouldStop()) {
      onSubmitted()
    }
  }
}
