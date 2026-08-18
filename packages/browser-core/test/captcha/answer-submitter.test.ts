import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnswerSubmitter } from '../../src/captcha/answer-submitter'

function createSubmitter(
  submitDelay: readonly [number, number] = [1000, 1000],
  multiClickDelay: readonly [number, number] = [500, 500],
): AnswerSubmitter {
  return new AnswerSubmitter(
    async () => submitDelay,
    async () => multiClickDelay,
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
