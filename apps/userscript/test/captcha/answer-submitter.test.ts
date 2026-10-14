import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnswerSubmitter } from '../../src/captcha/answer-submitter'

async function flushMicrotasks(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

function createForm(): HTMLFormElement {
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
  const button = document.createElement('input')
  button.id = 'riddlesubmit'
  button.type = 'submit'
  form.appendChild(button)
  return form
}

describe('AnswerSubmitter timing adapters', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses saved submit and multi-click timing ranges', async () => {
    localStorage.setItem('hvPonySolverSubmitDelay', '2500')
    localStorage.setItem('hvPonySolverMultiClickDelay', '700')
    const form = createForm()
    const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
    for (const checkbox of checkboxes) {
      checkbox.checked = false
    }
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.click = vi.fn()
    const onSubmitted = vi.fn()
    const submitPromise = new AnswerSubmitter().submit(form, ['TS', 'RA'], vi.fn(), onSubmitted)
    await flushMicrotasks()
    expect(checkboxes.filter((checkbox) => checkbox.checked)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(699)
    expect(checkboxes.filter((checkbox) => checkbox.checked)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(checkboxes.filter((checkbox) => checkbox.checked)).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(2499)
    expect(button.click).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await submitPromise

    expect(button.click).toHaveBeenCalledTimes(1)
    expect(onSubmitted).toHaveBeenCalledTimes(1)
  })

  it('uses asynchronous GM timing settings when available', async () => {
    const testGlobal = globalThis as typeof globalThis & {
      GM_getValue?: (key: string, defaultValue: string) => Promise<string>
    }
    testGlobal.GM_getValue = vi.fn(async (key: string) => (key === 'hvPonySolverSubmitDelay' ? '2600' : '800'))
    const form = createForm()
    const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')]
    for (const checkbox of checkboxes) {
      checkbox.checked = false
    }
    const button = form.querySelector<HTMLInputElement>('#riddlesubmit')!
    button.click = vi.fn()
    const submitPromise = new AnswerSubmitter().submit(form, ['TS', 'RA'], vi.fn(), vi.fn())
    try {
      await flushMicrotasks()
      expect(checkboxes.filter((checkbox) => checkbox.checked)).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(799)
      expect(checkboxes.filter((checkbox) => checkbox.checked)).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(checkboxes.filter((checkbox) => checkbox.checked)).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(2599)
      expect(button.click).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await submitPromise

      expect(button.click).toHaveBeenCalledTimes(1)
    } finally {
      delete testGlobal.GM_getValue
    }
  })
})
