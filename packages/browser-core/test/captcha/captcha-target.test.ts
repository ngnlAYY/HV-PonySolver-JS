import { beforeEach, describe, expect, it } from 'vitest'

import { findCaptchaTarget, isSameCaptchaTarget } from '../../src/captcha/captcha-target'

function appendCandidate({ imageSrc, formAction }: { imageSrc: string; formAction?: string }): HTMLDivElement {
  const master = document.createElement('div')
  master.id = 'riddlemaster'
  const form = document.createElement('form')
  form.name = 'riddleform'
  if (formAction) {
    form.action = formAction
  }
  for (let index = 0; index < 6; index += 1) {
    const answer = document.createElement('input')
    answer.name = 'riddleanswer[]'
    answer.type = 'checkbox'
    form.appendChild(answer)
  }
  const submit = document.createElement('input')
  submit.id = 'riddlesubmit'
  submit.type = 'submit'
  form.appendChild(submit)
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

  it('compares captcha identity by DOM references and normalized image URL', () => {
    const master = appendCandidate({ imageSrc: '/captcha.png', formAction: '/submit' })
    const first = findCaptchaTarget()
    const second = findCaptchaTarget()

    expect(isSameCaptchaTarget(first, second)).toBe(true)

    const replacement = appendCandidate({ imageSrc: '/captcha.png', formAction: '/submit' })
    master.replaceWith(replacement)

    expect(isSameCaptchaTarget(first, findCaptchaTarget())).toBe(false)
    expect(isSameCaptchaTarget(first, null)).toBe(false)
  })

  it('treats replaced, reordered, and disabled controls as target identity changes', () => {
    const master = appendCandidate({ imageSrc: '/captcha.png', formAction: '/submit' })
    const form = master.querySelector<HTMLFormElement>('form')!
    const answers = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]'))
    const submit = form.querySelector<HTMLInputElement>('#riddlesubmit')!

    const beforeReplacement = findCaptchaTarget()
    const replacement = answers[0]!.cloneNode(true)
    answers[0]!.replaceWith(replacement)
    expect(isSameCaptchaTarget(beforeReplacement, findCaptchaTarget())).toBe(false)

    const beforeReorder = findCaptchaTarget()
    form.appendChild(form.querySelectorAll<HTMLInputElement>('input[name="riddleanswer[]"]')[0]!)
    expect(isSameCaptchaTarget(beforeReorder, findCaptchaTarget())).toBe(false)

    const beforeDisable = findCaptchaTarget()
    submit.disabled = true
    expect(isSameCaptchaTarget(beforeDisable, findCaptchaTarget())).toBe(false)
  })
})
