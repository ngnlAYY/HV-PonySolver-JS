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

  it('supports the live form whose submit button starts disabled until an answer is selected', async () => {
    const form = createForm(true)
    const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
    for (const checkbox of checkboxes) {
      checkbox.checked = false
    }
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.disabled = true
    form.addEventListener('change', () => {
      const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length
      button.disabled = selectedCount === 0 || selectedCount >= 4
    })
    button.click = vi.fn()
    const onError = vi.fn()
    const onSubmitted = vi.fn()

    await createSubmitter([0, 0], [0, 0]).submit(form, ['TS'], onError, onSubmitted)

    expect(checkboxes[0]).toHaveProperty('checked', true)
    expect(button.disabled).toBe(false)
    expect(button.click).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
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

    it('cleans markers from an aborted partial selection without reversing clicks or inheriting automatic state', async () => {
      const form = createForm(true)
      const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
      for (const checkbox of checkboxes) checkbox.checked = false
      const ts = checkboxes[ANSWER_CODES.indexOf('TS')]!
      const tsClick = vi.spyOn(ts, 'click')
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const submitter = createSubmitter([0, 0], [100, 100])
      const controller = new AbortController()
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)

      try {
        const firstSubmit = submitter.submit(form, ['TS', 'RA'], vi.fn(), vi.fn(), {
          signal: controller.signal,
          confidences: { TS: 0.01, RA: 0.9 },
        })
        await vi.waitFor(() => expect(tsClick).toHaveBeenCalledTimes(1))

        controller.abort()
        await firstSubmit

        expect(ts).toHaveProperty('checked', true)
        expect(tsClick).toHaveBeenCalledTimes(1)

        const secondSubmit = submitter.submit(form, ['RA', 'FS', 'RD', 'PP'], vi.fn(), vi.fn(), {
          confidences: { RA: 0.9, FS: 0.8, RD: 0.7, PP: 0.6 },
        })
        await vi.runAllTimersAsync()
        await secondSubmit

        expect(ts).toHaveProperty('checked', true)
        expect(tsClick).toHaveBeenCalledTimes(1)
      } finally {
        randomSpy.mockRestore()
      }
    })

    it('cleans markers when the final submit click synchronously makes the target stale', async () => {
      const form = createForm(true)
      const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
      for (const checkbox of checkboxes) checkbox.checked = false
      const ts = checkboxes[ANSWER_CODES.indexOf('TS')]!
      const tsClick = vi.spyOn(ts, 'click')
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      let current = true
      button.click = vi.fn(() => {
        current = false
      })
      const onSubmitted = vi.fn()
      const submitter = createSubmitter([0, 0], [0, 0])

      const firstSubmit = submitter.submit(form, ['TS'], vi.fn(), onSubmitted, {
        isCurrent: () => current,
        confidences: { TS: 0.01 },
      })
      await vi.runAllTimersAsync()
      await firstSubmit

      expect(button.click).toHaveBeenCalledTimes(1)
      expect(onSubmitted).not.toHaveBeenCalled()
      expect(tsClick).toHaveBeenCalledTimes(1)

      current = true
      button.click = vi.fn()
      const secondSubmit = submitter.submit(form, ['RA', 'FS', 'RD', 'PP'], vi.fn(), vi.fn(), {
        confidences: { RA: 0.9, FS: 0.8, RD: 0.7, PP: 0.6 },
      })
      await vi.runAllTimersAsync()
      await secondSubmit

      expect(ts).toHaveProperty('checked', true)
      expect(tsClick).toHaveBeenCalledTimes(1)
    })

    it('restores previous automatic confidence when a later marker update becomes stale', async () => {
      const form = createForm(true)
      const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
      for (const checkbox of checkboxes) checkbox.checked = false
      const ts = checkboxes[ANSWER_CODES.indexOf('TS')]!
      const submitter = createSubmitter([0, 0], [0, 0])
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()

      const firstSubmit = submitter.submit(form, ['TS'], vi.fn(), vi.fn(), {
        confidences: { TS: 0.1 },
      })
      await vi.runAllTimersAsync()
      await firstSubmit

      let current = true
      button.click = vi.fn(() => {
        current = false
      })
      const staleSubmit = submitter.submit(form, ['TS'], vi.fn(), vi.fn(), {
        isCurrent: () => current,
        confidences: { TS: 0.9 },
      })
      await vi.runAllTimersAsync()
      await staleSubmit

      current = true
      button.click = vi.fn()
      const nextSubmit = submitter.submit(form, ['RA', 'FS', 'RD', 'PP'], vi.fn(), vi.fn(), {
        confidences: { RA: 0.9, FS: 0.8, RD: 0.7, PP: 0.6 },
      })
      await vi.runAllTimersAsync()
      await nextSubmit

      expect(ts).toHaveProperty('checked', false)
    })

    it('does not loop or reverse stale checkbox clicks when preservation is disabled', async () => {
      const form = createForm(true)
      const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
      for (const checkbox of checkboxes) checkbox.checked = false
      const ts = checkboxes[ANSWER_CODES.indexOf('TS')]!
      const tsClick = vi.spyOn(ts, 'click')
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      let current = true
      const buttonClick = vi.fn(() => {
        current = false
      })
      button.click = buttonClick
      const submitter = createSubmitter([0, 0], [0, 0], false)

      const staleSubmit = submitter.submit(form, ['TS'], vi.fn(), vi.fn(), {
        isCurrent: () => current,
      })
      await vi.runAllTimersAsync()
      await staleSubmit

      expect(ts).toHaveProperty('checked', true)
      expect(tsClick).toHaveBeenCalledTimes(1)
      expect(buttonClick).toHaveBeenCalledTimes(1)

      current = true
      buttonClick.mockImplementation(() => undefined)
      const nextSubmit = submitter.submit(form, ['TS'], vi.fn(), vi.fn(), {
        isCurrent: () => current,
      })
      await vi.runAllTimersAsync()
      await nextSubmit

      expect(ts).toHaveProperty('checked', true)
      expect(tsClick).toHaveBeenCalledTimes(3)
      expect(buttonClick).toHaveBeenCalledTimes(2)
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

    it('keeps a user selection manual when it is checked while timing settings are pending', async () => {
      const form = createForm(true)
      const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
      for (const checkbox of checkboxes) checkbox.checked = false
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      let resolveFirstSubmitDelay!: (range: readonly [number, number]) => void
      let firstDelay = true
      const submitter = new AnswerSubmitter(
        () => {
          if (!firstDelay) return Promise.resolve([0, 0])
          firstDelay = false
          return new Promise((resolve) => {
            resolveFirstSubmitDelay = resolve
          })
        },
        async () => [0, 0],
      )

      const firstSubmit = submitter.submit(form, ['TS'], vi.fn(), vi.fn(), { confidences: { TS: 0.01 } })
      await flushMicrotasks()
      checkboxes[ANSWER_CODES.indexOf('TS')]!.click()
      resolveFirstSubmitDelay([0, 0])
      await vi.runAllTimersAsync()
      await firstSubmit

      const secondSubmit = submitter.submit(form, ['TS', 'RA', 'FS', 'RD', 'PP'], vi.fn(), vi.fn(), {
        confidences: { TS: 0.01, RA: 0.02, FS: 0.9, RD: 0.8, PP: 0.7 },
      })
      await flushMicrotasks()
      await vi.runAllTimersAsync()
      await secondSubmit

      expect(checkboxes[ANSWER_CODES.indexOf('TS')]).toHaveProperty('checked', true)
    })

    it('keeps a user selection manual when it is checked during a multi-click delay', async () => {
      const form = createForm(true)
      const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
      for (const checkbox of checkboxes) checkbox.checked = false
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99)
      const submitter = createSubmitter([0, 0], [100, 100])

      try {
        const firstSubmit = submitter.submit(form, ['TS', 'RA'], vi.fn(), vi.fn(), {
          confidences: { TS: 0.9, RA: 0.1 },
        })
        await vi.waitFor(() => expect(checkboxes[ANSWER_CODES.indexOf('TS')]!.checked).toBe(true))
        checkboxes[ANSWER_CODES.indexOf('RA')]!.click()
        await vi.runAllTimersAsync()
        await firstSubmit

        const secondSubmit = submitter.submit(form, ['FS', 'RD', 'PP'], vi.fn(), vi.fn(), {
          confidences: { TS: 0.9, RA: 0.1, FS: 0.8, RD: 0.7, PP: 0.6 },
        })
        await vi.runAllTimersAsync()
        await secondSubmit

        expect(checkboxes[ANSWER_CODES.indexOf('RA')]).toHaveProperty('checked', true)
      } finally {
        randomSpy.mockRestore()
      }
    })

    it.each(['final delay', 'multi-click delay'] as const)(
      'trims live automatic answers after manual additions during the %s',
      async (stage) => {
        const form = createForm(true)
        const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
        for (const checkbox of checkboxes) checkbox.checked = false
        const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
        button.click = vi.fn()
        form.addEventListener('change', () => {
          const count = checkboxes.filter((checkbox) => checkbox.checked).length
          button.disabled = count === 0 || count >= 4
        })
        const onError = vi.fn()
        const onSubmitted = vi.fn()
        const submission = createSubmitter([1000, 1000], [100, 100]).submit(
          form,
          ['TS', 'RA', 'FS'],
          onError,
          onSubmitted,
          { confidences: { TS: 0.1, RA: 0.2, FS: 0.9 } },
        )
        await flushMicrotasks()
        if (stage === 'final delay') await vi.advanceTimersByTimeAsync(200)
        checkboxes[3]!.click()
        checkboxes[4]!.click()
        await vi.runAllTimersAsync()
        await submission
        expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([false, false, true, true, true, false])
        expect(button.click).toHaveBeenCalledTimes(1)
        expect(onSubmitted).toHaveBeenCalledTimes(1)
        expect(onError).not.toHaveBeenCalled()
      },
    )

    it.each(['removed answer', 'manual ownership', 'four selections', 'changed target', 'reentrant change'] as const)(
      'respects %s while reconciling final selections',
      async (scenario) => {
        const form = createForm(true)
        const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
        for (const checkbox of checkboxes) checkbox.checked = false
        const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
        button.click = vi.fn()
        let current = true
        const submission = createSubmitter([1000, 1000], [0, 0]).submit(form, ['TS', 'RA', 'FS'], vi.fn(), vi.fn(), {
          confidences: { TS: 0.1, RA: 0.2, FS: 0.9 },
          isCurrent: () => current,
        })
        await vi.advanceTimersByTimeAsync(1)
        checkboxes[3]!.click()
        if (scenario !== 'four selections') checkboxes[4]!.click()
        if (scenario === 'removed answer') checkboxes[0]!.click()
        if (scenario === 'manual ownership') {
          checkboxes[0]!.click()
          checkboxes[0]!.click()
        }
        if (scenario === 'changed target') {
          checkboxes[0]!.addEventListener('change', () => {
            current = false
          })
        }
        if (scenario === 'reentrant change') {
          checkboxes[0]!.addEventListener('change', () => {
            checkboxes[1]!.click()
            checkboxes[1]!.click()
          })
        }
        await vi.runAllTimersAsync()
        await submission
        const expected = {
          'removed answer': [false, true, true, true, true, false],
          'manual ownership': [true, false, false, true, true, false],
          'four selections': [true, true, true, true, false, false],
          'changed target': [false, true, true, true, true, false],
          'reentrant change': [false, true, false, true, true, false],
        }
        expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual(expected[scenario])
        expect(button.click).toHaveBeenCalledTimes(scenario === 'changed target' ? 0 : 1)
      },
    )

    it('updates confidence for an answer that was already automatic', async () => {
      const form = createForm(true)
      const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
      for (const checkbox of checkboxes) checkbox.checked = false
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const submitter = createSubmitter([0, 0], [0, 0])

      const firstSubmit = submitter.submit(form, ['TS'], vi.fn(), vi.fn(), { confidences: { TS: 0.1 } })
      await vi.runAllTimersAsync()
      await firstSubmit
      const secondSubmit = submitter.submit(form, ['TS'], vi.fn(), vi.fn(), { confidences: { TS: 0.9 } })
      await vi.runAllTimersAsync()
      await secondSubmit
      const thirdSubmit = submitter.submit(form, ['TS', 'RA', 'FS', 'RD', 'PP'], vi.fn(), vi.fn(), {
        confidences: { RA: 0.2, FS: 0.8, RD: 0.7, PP: 0.6 },
      })
      await vi.runAllTimersAsync()
      await thirdSubmit

      expect(checkboxes[ANSWER_CODES.indexOf('TS')]).toHaveProperty('checked', true)
    })

    it('keeps an automatic answer manual after the user unchecks and rechecks it', async () => {
      const form = createForm(true)
      const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
      for (const checkbox of checkboxes) checkbox.checked = false
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const submitter = createSubmitter([0, 0], [0, 0])
      const ra = checkboxes[ANSWER_CODES.indexOf('RA')]!

      const firstSubmit = submitter.submit(form, ['TS', 'RA'], vi.fn(), vi.fn(), {
        confidences: { TS: 0.9, RA: 0.1 },
      })
      await vi.runAllTimersAsync()
      await firstSubmit
      ra.click()
      ra.click()
      const secondSubmit = submitter.submit(form, ['FS', 'RD', 'PP'], vi.fn(), vi.fn(), {
        confidences: { TS: 0.9, RA: 0.1, FS: 0.8, RD: 0.7, PP: 0.6 },
      })
      await vi.runAllTimersAsync()
      await secondSubmit

      expect(ra).toHaveProperty('checked', true)
    })

    it.each(['form action', 'submit control'] as const)(
      'cleans new automatic markers when the %s changes after an answer click',
      async (change) => {
        const form = createForm(true)
        const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
        for (const checkbox of checkboxes) checkbox.checked = false
        const ts = checkboxes[ANSWER_CODES.indexOf('TS')]!
        const tsClick = vi.spyOn(ts, 'click')
        const initialAction = form.action
        const initialButton = form.querySelector<HTMLInputElement>('#riddlesubmit')!
        initialButton.click = vi.fn()
        ts.addEventListener(
          'change',
          () => {
            if (change === 'form action') {
              form.action = '/other-submit'
              return
            }
            const replacementButton = initialButton.cloneNode(true) as HTMLInputElement
            initialButton.replaceWith(replacementButton)
          },
          { once: true },
        )
        const submitter = createSubmitter([0, 0], [0, 0])

        const staleSubmit = submitter.submit(form, ['TS'], vi.fn(), vi.fn(), {
          confidences: { TS: 0.01 },
        })
        await vi.runAllTimersAsync()
        await staleSubmit

        expect(ts).toHaveProperty('checked', true)
        expect(tsClick).toHaveBeenCalledTimes(1)
        expect(initialButton.click).not.toHaveBeenCalled()

        form.action = initialAction
        const replacementButton = form.querySelector<HTMLInputElement>('#riddlesubmit')
        if (replacementButton && replacementButton !== initialButton) {
          replacementButton.click = vi.fn()
        }
        const nextSubmit = submitter.submit(form, ['RA', 'FS', 'RD', 'PP'], vi.fn(), vi.fn(), {
          confidences: { RA: 0.9, FS: 0.8, RD: 0.7, PP: 0.6 },
        })
        await vi.runAllTimersAsync()
        await nextSubmit

        expect(ts).toHaveProperty('checked', true)
        expect(tsClick).toHaveBeenCalledTimes(1)
      },
    )

    it('does not submit when the form action changes while timing settings are pending', async () => {
      const form = createForm(true)
      form.action = '/submit'
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const onSubmitted = vi.fn()
      let resolveSubmitDelay!: (range: readonly [number, number]) => void
      const submitter = new AnswerSubmitter(
        () =>
          new Promise((resolve) => {
            resolveSubmitDelay = resolve
          }),
        async () => [0, 0],
      )

      const submitPromise = submitter.submit(form, ['TS'], vi.fn(), onSubmitted)
      await flushMicrotasks()
      form.action = '/other-submit'
      resolveSubmitDelay([0, 0])
      await vi.runAllTimersAsync()
      await submitPromise

      expect(button.click).not.toHaveBeenCalled()
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

describe('submission control contracts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each(['all controls', 'submit only'] as const)('rejects inherited fieldset disabling of %s', async (scope) => {
    const form = createForm(true)
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    const fieldset = document.createElement('fieldset')
    fieldset.disabled = true
    fieldset.append(...(scope === 'all controls' ? Array.from(form.children) : [button]))
    form.appendChild(fieldset)
    const onSubmitted = vi.fn()
    const onError = vi.fn()
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    const submission = createSubmitter([0, 0], [0, 0]).submit(form, ['TS'], onError, onSubmitted)
    await vi.runAllTimersAsync()
    await submission
    expect(clicked).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalled()
  })

  it('keeps the first legend exemption of a disabled fieldset usable', async () => {
    const form = createForm(true)
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.click = vi.fn()
    const legend = document.createElement('legend')
    legend.append(...Array.from(form.children))
    const fieldset = document.createElement('fieldset')
    fieldset.disabled = true
    fieldset.appendChild(legend)
    form.appendChild(fieldset)
    const onSubmitted = vi.fn()
    const submission = createSubmitter([0, 0], [0, 0]).submit(form, ['TS'], vi.fn(), onSubmitted)
    await vi.runAllTimersAsync()
    await submission
    expect(button.click).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledTimes(1)
  })

  it('stops when a fieldset becomes disabled during the final delay', async () => {
    const form = createForm(true)
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.click = vi.fn()
    const fieldset = document.createElement('fieldset')
    fieldset.append(...Array.from(form.children))
    form.appendChild(fieldset)
    const onSubmitted = vi.fn()
    const submission = createSubmitter([100, 100], [0, 0]).submit(form, ['TS'], vi.fn(), onSubmitted)
    await flushMicrotasks()
    fieldset.disabled = true
    await vi.runAllTimersAsync()
    await submission
    expect(button.click).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
  })

  it.each(['/changed', 'https://example.invalid/changed'])(
    'stops a changed submitter action %s while timing loads',
    async (action) => {
      const form = createForm(true)
      form.action = '/original'
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const submitter = new AnswerSubmitter(
        async () => {
          button.setAttribute('formaction', action)
          return [0, 0]
        },
        async () => [0, 0],
      )
      const onSubmitted = vi.fn()
      const submission = submitter.submit(form, ['TS'], vi.fn(), onSubmitted)
      await vi.runAllTimersAsync()
      await submission
      expect(button.click).not.toHaveBeenCalled()
      expect(onSubmitted).not.toHaveBeenCalled()
    },
  )

  it('rejects an initially cross-origin submitter action', async () => {
    const form = createForm(true)
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.setAttribute('formaction', 'https://example.invalid/submit')
    button.click = vi.fn()
    const onSubmitted = vi.fn()
    const onError = vi.fn()
    const submission = createSubmitter([0, 0], [0, 0]).submit(form, ['TS'], onError, onSubmitted)
    await vi.runAllTimersAsync()
    await submission
    expect(button.click).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('答案控件不可用')
  })

  it.each(['equivalent submit action', 'button action ignored'] as const)('allows %s', async (mode) => {
    const form = createForm(true)
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.type = mode === 'button action ignored' ? 'button' : 'submit'
    button.setAttribute('formaction', '/same')
    button.click = vi.fn()
    const submitter = new AnswerSubmitter(
      async () => {
        button.setAttribute(
          'formaction',
          mode === 'button action ignored' ? 'https://example.invalid/unused' : new URL('/same', location.href).href,
        )
        return [0, 0]
      },
      async () => [0, 0],
    )
    const onSubmitted = vi.fn()
    const submission = submitter.submit(form, ['TS'], vi.fn(), onSubmitted)
    await vi.runAllTimersAsync()
    await submission
    expect(button.click).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledTimes(1)
  })

  it.each(['answer', 'submit'] as const)('stops a same-element %s type change while timing loads', async (control) => {
    const form = createForm(true)
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.click = vi.fn()
    const submitter = new AnswerSubmitter(
      async () => {
        if (control === 'answer') form.querySelector<HTMLInputElement>('input[name="riddleanswer[]"]')!.type = 'radio'
        else button.type = 'button'
        return [0, 0]
      },
      async () => [0, 0],
    )
    const onSubmitted = vi.fn()
    const submission = submitter.submit(form, ['TS'], vi.fn(), onSubmitted)
    await vi.runAllTimersAsync()
    await submission
    expect(button.click).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
  })

  it.each([true, false])('rechecks initial trim ownership with preservation %s', async (preserve) => {
    const form = createForm(true)
    const answers = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
    for (const answer of answers) answer.checked = false
    form.querySelector<HTMLInputElement>('#riddlesubmit')!.click = vi.fn()
    const submitter = createSubmitter([0, 0], [0, 0], preserve)
    const first = submitter.submit(form, ['TS', 'RA'], vi.fn(), vi.fn(), { confidences: { TS: 0.1, RA: 0.2 } })
    await vi.runAllTimersAsync()
    await first
    answers[0]!.addEventListener(
      'change',
      () => {
        answers[1]!.click()
        answers[1]!.click()
      },
      { once: true },
    )
    const second = submitter.submit(form, ['FS', 'RD', 'PP'], vi.fn(), vi.fn(), {
      confidences: { FS: 0.9, RD: 0.8, PP: 0.7 },
    })
    await vi.runAllTimersAsync()
    await second
    expect(answers[1]!.checked).toBe(preserve)
  })
})

it('rejects unsupported image submitters instead of clicking with ignored override semantics', async () => {
  const form = createForm(true)
  const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
  button.type = 'image'
  button.setAttribute('formaction', '/image-submit')
  button.click = vi.fn()
  const onError = vi.fn()
  const onSubmitted = vi.fn()
  await createSubmitter([0, 0], [0, 0]).submit(form, ['TS'], onError, onSubmitted)
  expect(button.click).not.toHaveBeenCalled()
  expect(onSubmitted).not.toHaveBeenCalled()
  expect(onError).toHaveBeenCalledWith('答案控件不可用')
})
