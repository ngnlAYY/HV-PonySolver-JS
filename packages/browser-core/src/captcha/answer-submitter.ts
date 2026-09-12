import { ANSWER_CODES, type AnswerCode } from '@hv-pony-solver/shared/answer'
import { randDelay, shuffle, sleep } from '../utils/delay'
import { captchaSelectors } from './captcha-selectors'
import { getSubmissionAction, isSameOriginForm } from './captcha-target'
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
    ['submit', 'button'].includes(controls.button.type) &&
    controls.checkboxes.every(
      (checkbox) =>
        checkbox.isConnected &&
        checkbox.form === form &&
        checkbox.type === 'checkbox' &&
        !checkbox.matches(':disabled'),
    )
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

  private programmaticCheckboxClick: HTMLInputElement | null = null

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
      if (this.programmaticCheckboxClick !== checkbox) {
        this.automaticConfidences.delete(checkbox)
      }
    })
  }

  private clickCheckbox(checkbox: HTMLInputElement): void {
    const previousClick = this.programmaticCheckboxClick
    this.programmaticCheckboxClick = checkbox
    try {
      checkbox.click()
    } finally {
      this.programmaticCheckboxClick = previousClick
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
    const automaticConfidenceWrites = new Map<
      HTMLInputElement,
      Readonly<{ previous: number | undefined; written: number }>
    >()
    const writeAutomaticConfidence = (checkbox: HTMLInputElement, confidence: number): void => {
      const existingWrite = automaticConfidenceWrites.get(checkbox)
      automaticConfidenceWrites.set(checkbox, {
        previous: existingWrite ? existingWrite.previous : this.automaticConfidences.get(checkbox),
        written: confidence,
      })
      this.automaticConfidences.set(checkbox, confidence)
    }
    const cleanStaleAutomaticConfidences = (): void => {
      for (const [checkbox, { previous, written }] of automaticConfidenceWrites) {
        if (this.automaticConfidences.get(checkbox) !== written) {
          continue
        }
        if (previous === undefined) {
          this.automaticConfidences.delete(checkbox)
        } else {
          this.automaticConfidences.set(checkbox, previous)
        }
      }
    }

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
    const expectedFormAction = form.action
    const expectedSubmitType = expectedControls.button.type
    const expectedSubmitAction = getSubmissionAction(form, expectedControls.button)
    if (!isSameOriginForm(form, expectedControls.button) || !controlsAreUsable(form, expectedControls)) {
      onError('答案控件不可用')
      return
    }
    for (const checkbox of expectedControls.checkboxes) {
      this.observeCheckbox(checkbox)
    }

    const currentControls = (): SubmissionControls | null => {
      if (shouldStop()) {
        cleanStaleAutomaticConfidences()
        return null
      }
      const current = readControls(form)
      if (current.checkboxes.length !== ANSWER_CODES.length || !current.button) {
        cleanStaleAutomaticConfidences()
        return null
      }
      const controls: SubmissionControls = {
        checkboxes: current.checkboxes,
        button: current.button,
      }
      if (
        !hasSameControls(expectedControls, controls) ||
        form.action !== expectedFormAction ||
        controls.button.type !== expectedSubmitType ||
        getSubmissionAction(form, controls.button) !== expectedSubmitAction ||
        !isSameOriginForm(form, controls.button) ||
        !controlsAreUsable(form, controls)
      ) {
        cleanStaleAutomaticConfidences()
        return null
      }
      return controls
    }

    const indices = ponies.map((pony) => ANSWER_CODES.indexOf(pony)).filter((index) => index >= 0)
    if (!indices.length) {
      onError('无有效答案')
      return
    }

    const [submitDelay, multiClickDelay] = await Promise.all([
      this.getSubmitDelayRange(),
      this.getMultiClickDelayRange(),
    ])
    if (!currentControls()) {
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

    const indicesToClear: number[] = []
    if (!preserveCheckedAnswers) {
      for (let i = 0; i < expectedControls.checkboxes.length; i += 1) {
        indicesToClear.push(i)
      }
    } else {
      const selectedAutomatic = new Set(automaticIndices)
      for (const index of previouslyAutomatic.keys()) {
        if (!selectedAutomatic.has(index)) {
          indicesToClear.push(index)
        }
      }
    }

    for (const index of indicesToClear) {
      const controls = currentControls()
      if (!controls) {
        return
      }
      const checkbox = controls.checkboxes[index]
      // 前一项的 change 回调可能将待裁剪项转为手动勾选。
      if (checkbox && preserveCheckedAnswers && !this.automaticConfidences.has(checkbox)) continue
      if (checkbox?.checked) {
        this.clickCheckbox(checkbox)
      }
      if (checkbox) {
        this.automaticConfidences.delete(checkbox)
      }
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
      const wasChecked = checkbox.checked
      const wasAutomatic = this.automaticConfidences.has(checkbox)
      if (!checkbox.checked) {
        this.clickCheckbox(checkbox)
      }
      if (checkbox.checked && (!wasChecked || wasAutomatic)) {
        writeAutomaticConfidence(checkbox, confidenceForIndex(index, options?.confidences, previouslyAutomatic))
      }
      if (i < order.length - 1) {
        await sleep(randDelay(multiClickDelay), signal)
        if (!currentControls()) {
          return
        }
      }
    }

    await sleep(randDelay(submitDelay), signal)
    let controls = currentControls()
    if (!controls) {
      return
    }
    if (preserveCheckedAnswers && controls.checkboxes.filter((checkbox) => checkbox.checked).length > 4) {
      // 等待期间用户可能新增或撤销答案。只裁剪当前仍归程序所有的勾选，
      // 每次 change 回调后重新读取，避免接管手动项或操作已替换的控件。
      for (let attempt = 0; attempt < ANSWER_CODES.length; attempt += 1) {
        controls = currentControls()
        if (!controls) return
        const checked = controls.checkboxes.filter((checkbox) => checkbox.checked)
        if (checked.length <= 3) break
        const automatic = checked.filter((checkbox) => this.automaticConfidences.has(checkbox))
        automatic.sort((left, right) => {
          const difference =
            (this.automaticConfidences.get(left) ?? Number.NEGATIVE_INFINITY) -
            (this.automaticConfidences.get(right) ?? Number.NEGATIVE_INFINITY)
          return Number.isNaN(difference) ? 0 : difference
        })
        const checkbox = automatic[0]
        if (!checkbox) break
        this.clickCheckbox(checkbox)
        this.automaticConfidences.delete(checkbox)
      }
      controls = currentControls()
      if (!controls) return
    }
    if (controls.button.matches(':disabled')) {
      onError('提交按钮不可用')
      return
    }

    controls.button.click()
    if (!currentControls()) {
      return
    }
    onSubmitted()
  }
}
