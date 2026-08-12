import { beforeEach, describe, expect, it } from 'vitest'

import { findCaptchaTarget } from '../../src/captcha/captcha-target'

function appendCandidate({ imageSrc, formAction }: { imageSrc: string, formAction?: string }): HTMLDivElement {
  const master = document.createElement('div')
  master.id = 'riddlemaster'
  const form = document.createElement('form')
  form.name = 'riddleform'
  if (formAction) {
    form.action = formAction
  }
  const imageContainer = document.createElement('div')
  imageContainer.id = 'riddleimage'
  const image = document.createElement('img')
  image.src = imageSrc
  imageContainer.appendChild(image)
  master.append(form, imageContainer)
  document.body.appendChild(master)
  return master
}

describe('findCaptchaTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('returns captcha targets with same-origin image and form action', () => {
    const master = appendCandidate({ imageSrc: '/captcha.png', formAction: '/submit' })

    expect(findCaptchaTarget()).toMatchObject({ master })
  })

  it('ignores candidates whose image URL is cross-origin', () => {
    appendCandidate({ imageSrc: 'https://example.invalid/captcha.png', formAction: '/submit' })

    expect(findCaptchaTarget()).toBeNull()
  })

  it('ignores candidates whose form action is cross-origin', () => {
    appendCandidate({ imageSrc: '/captcha.png', formAction: 'https://example.invalid/submit' })

    expect(findCaptchaTarget()).toBeNull()
  })
})
