import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ANSWER_CODES } from '@hv-pony-solver/shared/answer'
import { AnswerSubmitter } from '../../src/captcha/answer-submitter'

function createSubmitter(
  submitDelay: readonly [number, number] = [1000, 1000],
  multiClickDelay: readonly [number, number] = [500, 500],
  preserveCheckedAnswers = true,
): AnswerSubmitter {
  return new AnswerSubmitter(
    async () => submitDelay,
    async () => multiClickDelay,
    () => preserveCheckedAnswers,
  )
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function createForm(includeSubmitButton: boolean): HTMLFormElement {
  document.body.innerHTML = '<form name="riddleform"></form>'
  const form = document.querySelector<HTMLFormElement>('form[name="riddleform"]')
  if (!form) {
    throw new Error('test form missing')
  }
  for (let i = 0; i < 6; i += 1) {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.name = 'riddleanswer[]'
    checkbox.checked = i === 0
    form.appendChild(checkbox)
  }
  if (includeSubmitButton) {
    const button = document.createElement('input')
    button.id = 'riddlesubmit'
    button.type = 'submit'
    form.appendChild(button)
  }
  return form
}

describe('AnswerSubmitter', () => {
  it('does not change checkbox state when submit button is missing', async () => {
    const form = createForm(false)
    const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
    const initialState = checkboxes.map((checkbox) => checkbox.checked)
    const onError = vi.fn()

    await createSubmitter().submit(form, ['RA'], onError, vi.fn())

    expect(onError).toHaveBeenCalledWith('未找到提交按钮')
    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual(initialState)
  })

  it('preserves checked answers and removes the lowest-confidence automatic answers above four selections', async () => {
    const form = createForm(true)
    const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
    for (const checkbox of checkboxes) {
      checkbox.checked = false
    }
    checkboxes[0]!.checked = true
    checkboxes[1]!.checked = true
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.click = vi.fn()
    const onSubmitted = vi.fn()

    await createSubmitter([0, 0], [0, 0]).submit(form, ['FS', 'RD', 'PP'], vi.fn(), onSubmitted, {
      confidences: { FS: 0.91, RD: 0.32, PP: 0.71 },
    })

    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, true, true, false, false, false])
    expect(button.click).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledTimes(1)
  })

  it('never removes prechecked answers even when automatic answers cannot bring the total below three', async () => {
    const form = createForm(true)
    const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
    for (const checkbox of checkboxes) {
      checkbox.checked = false
    }
    for (const checkbox of checkboxes.slice(0, 4)) {
      checkbox.checked = true
    }
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.click = vi.fn()

    await createSubmitter([0, 0], [0, 0]).submit(form, ['PP', 'AJ'], vi.fn(), vi.fn(), {
      confidences: { PP: 0.1, AJ: 0.9 },
    })

    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, true, true, true, false, false])
  })

  it('keeps previous automatic answers eligible for confidence-based removal', async () => {
    const form = createForm(true)
    const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
    for (const checkbox of checkboxes) {
      checkbox.checked = false
    }
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.click = vi.fn()
    const submitter = createSubmitter([0, 0], [0, 0])

    await submitter.submit(form, ['FS', 'RD'], vi.fn(), vi.fn(), {
      confidences: { FS: 0.9, RD: 0.2 },
    })

    const manualIndex = ANSWER_CODES.indexOf('AJ')
    checkboxes[manualIndex]!.checked = true

    await submitter.submit(form, ['FS', 'RD', 'PP', 'TS', 'AJ'], vi.fn(), vi.fn(), {
      confidences: { FS: 0.9, RD: 0.8, PP: 0.1, TS: 0.6, AJ: 0.5 },
    })

    expect(checkboxes[ANSWER_CODES.indexOf('FS')]).toHaveProperty('checked', true)
    expect(checkboxes[ANSWER_CODES.indexOf('RD')]).toHaveProperty('checked', true)
    expect(checkboxes[ANSWER_CODES.indexOf('PP')]).toHaveProperty('checked', false)
    expect(checkboxes[manualIndex]).toHaveProperty('checked', true)
  })

  it('clears prechecked answers when preservation is disabled', async () => {
    const form = createForm(true)
    const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
    checkboxes[1]!.checked = true
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.click = vi.fn()

    await createSubmitter([0, 0], [0, 0], false).submit(form, ['FS'], vi.fn(), vi.fn())

    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([false, false, true, false, false, false])
  })

  describe('AbortSignal support', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('does not call onSubmitted or onError or click button when signal is already aborted', async () => {
      const form = createForm(true)
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const onError = vi.fn()
      const onSubmitted = vi.fn()

      const controller = new AbortController()
      controller.abort()

      await createSubmitter().submit(form, ['TS'], onError, onSubmitted, { signal: controller.signal })

      expect(onSubmitted).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(button.click).not.toHaveBeenCalled()
    })

    it('does not click later checkboxes or submit when signal is aborted during multi-select delay', async () => {
      const form = createForm(true)
      const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
      for (const checkbox of checkboxes) {
        checkbox.checked = false
      }
      const checkboxClicks = checkboxes.map((checkbox) => vi.spyOn(checkbox, 'click'))
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const onError = vi.fn()
      const onSubmitted = vi.fn()
      const controller = new AbortController()

      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
      try {
        const submitPromise = createSubmitter().submit(form, ['TS', 'RA'], onError, onSubmitted, {
          signal: controller.signal,
        })
        await vi.waitFor(() => expect(checkboxClicks[0]).toHaveBeenCalledTimes(1))

        controller.abort()
        await submitPromise
      } finally {
        randomSpy.mockRestore()
      }

      expect(checkboxClicks[0]).toHaveBeenCalledTimes(1)
      expect(checkboxClicks[1]).not.toHaveBeenCalled()
      expect(button.click).not.toHaveBeenCalled()
      expect(onSubmitted).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('uses injected submit and multi-click timing ranges', async () => {
      const form = createForm(true)
      const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
      for (const checkbox of checkboxes) {
        checkbox.checked = false
      }
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const onSubmitted = vi.fn()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      const submitPromise = createSubmitter([2500, 2500], [700, 700]).submit(form, ['TS', 'RA'], vi.fn(), onSubmitted)
      await vi.waitFor(() => expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 700))
      await vi.runOnlyPendingTimersAsync()
      await flushMicrotasks()
      expect(setTimeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 2500)
      await vi.runOnlyPendingTimersAsync()
      await submitPromise

      expect(button.click).toHaveBeenCalledTimes(1)
      expect(onSubmitted).toHaveBeenCalledTimes(1)
    })

    it('awaits asynchronous timing providers', async () => {
      const form = createForm(true)
      const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
      for (const checkbox of checkboxes) {
        checkbox.checked = false
      }
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

      const submitter = new AnswerSubmitter(
        async () => [2600, 2600],
        async () => [800, 800],
      )
      const submitPromise = submitter.submit(form, ['TS', 'RA'], vi.fn(), vi.fn())
      await vi.waitFor(() => expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 800))
      await vi.runOnlyPendingTimersAsync()
      await flushMicrotasks()
      expect(setTimeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 2600)
      await vi.runOnlyPendingTimersAsync()
      await submitPromise

      expect(button.click).toHaveBeenCalledTimes(1)
    })

    it('does not click submit when signal is aborted during submit delay', async () => {
      const form = createForm(true)
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const onError = vi.fn()
      const onSubmitted = vi.fn()
      const controller = new AbortController()

      const submitPromise = createSubmitter().submit(form, ['TS'], onError, onSubmitted, {
        signal: controller.signal,
      })
      await flushMicrotasks()

      controller.abort()
      await submitPromise

      expect(button.click).not.toHaveBeenCalled()
      expect(onSubmitted).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('does not click submit or record success when the captcha is no longer current', async () => {
      const form = createForm(true)
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const onSubmitted = vi.fn()
      let current = true

      const submitPromise = createSubmitter().submit(form, ['TS'], vi.fn(), onSubmitted, {
        isCurrent: () => current,
      })
      await flushMicrotasks()
      current = false
      await vi.runAllTimersAsync()
      await submitPromise

      expect(button.click).not.toHaveBeenCalled()
      expect(onSubmitted).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('does not submit through controls replaced while timing settings are pending', async () => {
      const form = createForm(true)
      const oldButton = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      oldButton.click = vi.fn()
      const onSubmitted = vi.fn()
      let resolveSubmitDelay!: (range: readonly [number, number]) => void
      const submitter = new AnswerSubmitter(
        () =>
          new Promise((resolve) => {
            resolveSubmitDelay = resolve
          }),
        async () => [500, 500],
      )

      const submitPromise = submitter.submit(form, ['TS'], vi.fn(), onSubmitted)
      await flushMicrotasks()

      const oldAnswer = form.querySelector<HTMLInputElement>('input[name="riddleanswer[]"]')!
      oldAnswer.replaceWith(oldAnswer.cloneNode(true))
      const newButton = oldButton.cloneNode(true) as HTMLInputElement
      newButton.click = vi.fn()
      oldButton.replaceWith(newButton)
      resolveSubmitDelay([1000, 1000])

      await vi.runAllTimersAsync()
      await submitPromise

      expect(oldButton.click).not.toHaveBeenCalled()
      expect(newButton.click).not.toHaveBeenCalled()
      expect(onSubmitted).not.toHaveBeenCalled()
    })

    it('does not submit when the captured form is disconnected during the delay', async () => {
      const form = createForm(true)
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const onSubmitted = vi.fn()

      const submitPromise = createSubmitter().submit(form, ['TS'], vi.fn(), onSubmitted)
      await flushMicrotasks()
      form.remove()

      await vi.runAllTimersAsync()
      await submitPromise

      expect(button.click).not.toHaveBeenCalled()
      expect(onSubmitted).not.toHaveBeenCalled()
    })

    it('does not click a submit button disabled during the delay', async () => {
      const form = createForm(true)
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const onSubmitted = vi.fn()

      const submitPromise = createSubmitter().submit(form, ['TS'], vi.fn(), onSubmitted)
      await flushMicrotasks()
      button.disabled = true

      await vi.runAllTimersAsync()
      await submitPromise

      expect(button.click).not.toHaveBeenCalled()
      expect(onSubmitted).not.toHaveBeenCalled()
    })

    it('does not submit when an answer control is disabled during the delay', async () => {
      const form = createForm(true)
      const checkbox = form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')[0]!
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const onSubmitted = vi.fn()

      const submitPromise = createSubmitter().submit(form, ['TS'], vi.fn(), onSubmitted)
      await flushMicrotasks()
      checkbox.disabled = true

      await vi.runAllTimersAsync()
      await submitPromise

      expect(button.click).not.toHaveBeenCalled()
      expect(onSubmitted).not.toHaveBeenCalled()
    })

    it('stops before later clicks when answer controls are reordered during a multi-click delay', async () => {
      const form = createForm(true)
      const checkboxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]'))
      for (const checkbox of checkboxes) {
        checkbox.checked = false
      }
      const checkboxClicks = checkboxes.map((checkbox) => vi.spyOn(checkbox, 'click'))
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const onSubmitted = vi.fn()
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)

      try {
        const submitPromise = createSubmitter().submit(form, ['TS', 'RA'], vi.fn(), onSubmitted)
        await vi.waitFor(() => expect(checkboxClicks[0]).toHaveBeenCalledTimes(1))
        form.appendChild(checkboxes[0]!)

        await vi.runAllTimersAsync()
        await submitPromise
      } finally {
        randomSpy.mockRestore()
      }

      expect(checkboxClicks[1]).not.toHaveBeenCalled()
      expect(button.click).not.toHaveBeenCalled()
      expect(onSubmitted).not.toHaveBeenCalled()
    })
  })
})
