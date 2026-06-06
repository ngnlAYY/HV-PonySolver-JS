import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnswerSubmitter } from '../../src/captcha/answer-submitter'

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

    await new AnswerSubmitter().submit(form, ['RA'], onError, vi.fn())

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

      await new AnswerSubmitter().submit(form, ['TS'], onError, onSubmitted, { signal: controller.signal })

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
        const submitPromise = new AnswerSubmitter().submit(form, ['TS', 'RA'], onError, onSubmitted, {
          signal: controller.signal,
        })
        await flushMicrotasks()

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

    it('does not click submit when signal is aborted during submit delay', async () => {
      const form = createForm(true)
      const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
      button.click = vi.fn()
      const onError = vi.fn()
      const onSubmitted = vi.fn()
      const controller = new AbortController()

      const submitPromise = new AnswerSubmitter().submit(form, ['TS'], onError, onSubmitted, {
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
  })
})
