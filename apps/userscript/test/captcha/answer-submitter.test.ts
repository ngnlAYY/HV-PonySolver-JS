import { describe, expect, it, vi } from 'vitest'

import { AnswerSubmitter } from '../../src/captcha/answer-submitter'

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
})
