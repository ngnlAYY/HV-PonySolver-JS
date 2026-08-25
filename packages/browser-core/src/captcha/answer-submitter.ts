import { ANSWER_CODES, type AnswerCode } from '@hv-pony-solver/shared/answer'
import { randDelay, shuffle, sleep } from '../utils/delay'
import { captchaSelectors } from './captcha-selectors'
import type { DelayRange } from './timing-settings'

export type SubmitErrorHandler = (message: string) => void

export type AnswerConfidenceMap = Partial<Record<AnswerCode, number>>

export type SubmitOptions = {
  signal?: AbortSignal
  isCurrent?: () => boolean
  confidences?: AnswerConfidenceMap
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
export type PreserveCheckedAnswersProvider = () => boolean

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

function uniqueIndices(indices: readonly number[]): number[] {
  return [...new Set(indices)]
}

function confidenceForIndex(
  index: number,
  confidences: AnswerConfidenceMap | undefined,
  fallbackConfidences?: ReadonlyMap<number, number>,
): number {
  const pony = ANSWER_CODES[index]
  const confidence = pony === undefined ? undefined : confidences?.[pony]
  if (typeof confidence === 'number' && Number.isFinite(confidence)) {
    return confidence
  }
  const fallback = fallbackConfidences?.get(index)
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : Number.NEGATIVE_INFINITY
}

function selectAutomaticIndices(
  indices: readonly number[],
  manuallyChecked: ReadonlySet<number>,
  previouslyAutomatic: ReadonlyMap<number, number>,
  preserveCheckedAnswers: boolean,
  confidences: AnswerConfidenceMap | undefined,
): number[] {
  const unique = uniqueIndices(indices)
  if (!preserveCheckedAnswers) {
    return unique
  }

  const automatic = uniqueIndices([...previouslyAutomatic.keys(), ...unique]).filter(
    (index) => !manuallyChecked.has(index),
  )
  const totalSelected = manuallyChecked.size + automatic.length
  if (totalSelected <= 4) {
    return automatic
  }

  const removeCount = totalSelected - 3
  const lowestConfidence = [...automatic]
    .sort((left, right) => {
      const difference =
        confidenceForIndex(left, confidences, previouslyAutomatic) -
        confidenceForIndex(right, confidences, previouslyAutomatic)
      return Number.isNaN(difference) ? left - right : difference || left - right
    })
    .slice(0, removeCount)
  const removed = new Set(lowestConfidence)
  return automatic.filter((index) => !removed.has(index))
}

export class AnswerSubmitter implements AnswerSubmissionService {
  private readonly automaticConfidences = new WeakMap<HTMLInputElement, number>()

  private readonly observedCheckboxes = new WeakSet<HTMLInputElement>()

  private programmaticCheckboxClick = false

  constructor(
    private readonly getSubmitDelayRange: DelayRangeProvider,
    private readonly getMultiClickDelayRange: DelayRangeProvider,
    private readonly getPreserveCheckedAnswers: PreserveCheckedAnswersProvider = () => true,
  ) {}

  private observeCheckbox(checkbox: HTMLInputElement): void {
    if (this.observedCheckboxes.has(checkbox)) {
      return
    }
    this.observedCheckboxes.add(checkbox)
    checkbox.addEventListener('change', () => {
      if (!this.programmaticCheckboxClick) {
        this.automaticConfidences.delete(checkbox)
      }
    })
  }

  private clickCheckbox(checkbox: HTMLInputElement): void {
    this.programmaticCheckboxClick = true
    try {
      checkbox.click()
    } finally {
      this.programmaticCheckboxClick = false
    }
  }

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
    for (const checkbox of expectedControls.checkboxes) {
      this.observeCheckbox(checkbox)
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

    const manuallyChecked = new Set<number>()
    const previouslyAutomatic = new Map<number, number>()
    for (let i = 0; i < expectedControls.checkboxes.length; i += 1) {
      const checkbox = expectedControls.checkboxes[i]
      if (!checkbox?.checked) {
        continue
      }
      const automaticConfidence = this.automaticConfidences.get(checkbox)
      if (automaticConfidence === undefined) {
        manuallyChecked.add(i)
      } else {
        previouslyAutomatic.set(i, automaticConfidence)
      }
    }
    const preserveCheckedAnswers = this.getPreserveCheckedAnswers()
    const automaticIndices = selectAutomaticIndices(
      indices,
      manuallyChecked,
      previouslyAutomatic,
      preserveCheckedAnswers,
      options?.confidences,
    )

    if (!preserveCheckedAnswers) {
      for (let i = 0; i < expectedControls.checkboxes.length; i += 1) {
        const controls = currentControls()
        if (!controls) {
          return
        }
        const checkbox = controls.checkboxes[i]
        if (checkbox?.checked) {
          this.clickCheckbox(checkbox)
        }
        if (checkbox) {
          this.automaticConfidences.delete(checkbox)
        }
      }
    } else {
      const selectedAutomatic = new Set(automaticIndices)
      for (const index of previouslyAutomatic.keys()) {
        if (selectedAutomatic.has(index)) {
          continue
        }
        const controls = currentControls()
        if (!controls) {
          return
        }
        const checkbox = controls.checkboxes[index]
        if (checkbox?.checked) {
          this.clickCheckbox(checkbox)
        }
        if (checkbox) {
          this.automaticConfidences.delete(checkbox)
        }
      }
    }

    const [submitDelay, multiClickDelay] = await Promise.all([
      this.getSubmitDelayRange(),
      this.getMultiClickDelayRange(),
    ])
    if (!currentControls()) {
      return
    }

    const order = shuffle(automaticIndices)
    for (let i = 0; i < order.length; i += 1) {
      const controls = currentControls()
      if (!controls) {
        return
      }
      const index = order[i]
      if (index === undefined) {
        continue
      }
      const checkbox = controls.checkboxes[index]
      if (!checkbox) {
        continue
      }
      if (!checkbox.checked) {
        this.clickCheckbox(checkbox)
      }
      if (checkbox.checked) {
        this.automaticConfidences.set(checkbox, confidenceForIndex(index, options?.confidences, previouslyAutomatic))
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
