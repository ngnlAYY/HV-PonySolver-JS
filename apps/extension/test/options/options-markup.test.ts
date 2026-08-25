import { describe, expect, it } from 'vitest'

import { installOptionsPageMarkup, optionsElement } from './options-page-fixture'

describe('options base markup', () => {
  it('fails safe with every Key action disabled and ordinary Save available', () => {
    installOptionsPageMarkup()

    const fieldset = optionsElement<HTMLFieldSetElement>('model-key-fieldset')
    const saveButton = document.querySelector<HTMLButtonElement>('button[type="submit"]')
    const hint = optionsElement<HTMLParagraphElement>('packaged-model-hint')

    expect(fieldset.disabled).toBe(true)
    expect(fieldset.contains(optionsElement('model-key'))).toBe(true)
    expect(fieldset.contains(optionsElement('verify-key'))).toBe(true)
    expect(fieldset.contains(optionsElement('query-model-quota'))).toBe(true)
    expect(fieldset.contains(optionsElement('download-model'))).toBe(true)
    expect(fieldset.contains(optionsElement('clear-key'))).toBe(true)
    const cancelKeyOperation = optionsElement<HTMLButtonElement>('cancel-key-op')
    expect(fieldset.contains(cancelKeyOperation)).toBe(true)
    expect(cancelKeyOperation.disabled).toBe(true)
    expect(saveButton).not.toBeNull()
    expect(saveButton?.disabled).toBe(true)
    expect(fieldset.contains(saveButton)).toBe(false)
    expect(fieldset.getAttribute('aria-describedby')).toBe(hint.id)
    expect(hint.hidden).toBe(true)
    expect(hint.textContent).toBe('当前版本已内置模型，无需配置模型 Key。')
  })
})
