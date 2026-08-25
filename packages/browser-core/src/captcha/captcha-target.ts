import { captchaSelectors } from './captcha-selectors'

export type CaptchaControlsSnapshot = Readonly<{
  answers: readonly HTMLInputElement[]
  answerDisabled: readonly boolean[]
  submit: HTMLInputElement | null
}>

export type CaptchaTarget = Readonly<{
  master: Element
  form: HTMLFormElement
  image: HTMLImageElement
  controls: CaptchaControlsSnapshot
  captchaKey: string
}>

function captureControls(form: HTMLFormElement): CaptchaControlsSnapshot {
  const answers = Array.from(form.querySelectorAll<HTMLInputElement>(captchaSelectors.answers))
  const submit = form.querySelector<HTMLInputElement>(captchaSelectors.submit)
  return {
    answers,
    answerDisabled: answers.map((answer) => answer.disabled),
    submit,
  }
}

function isSameControls(left: CaptchaControlsSnapshot, right: CaptchaControlsSnapshot): boolean {
  return (
    left.submit === right.submit &&
    left.answers.length === right.answers.length &&
    left.answers.every(
      (answer, index) => answer === right.answers[index] && left.answerDisabled[index] === right.answerDisabled[index],
    )
  )
}

export function isSameCaptchaTarget(left: CaptchaTarget | null, right: CaptchaTarget | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.master === right.master &&
    left.form === right.form &&
    left.image === right.image &&
    isSameControls(left.controls, right.controls) &&
    left.captchaKey === right.captchaKey
  )
}

function isSameOriginUrl(url: string): boolean {
  try {
    return new URL(url, location.href).origin === location.origin
  } catch {
    return false
  }
}

function isSameOriginForm(form: HTMLFormElement): boolean {
  return !form.action || isSameOriginUrl(form.action)
}

export function findCaptchaTarget(): CaptchaTarget | null {
  const masters = document.querySelectorAll(captchaSelectors.master)
  for (let index = 0; index < masters.length; index += 1) {
    const master = masters.item(index)
    const imageContainer = master.querySelector<HTMLElement>('[id="riddleimage"]')
    const image = imageContainer?.querySelector<HTMLImageElement>('img')
    const form = master.querySelector<HTMLFormElement>(captchaSelectors.form)
    const captchaKey = image?.currentSrc || image?.src || ''
    if (form && image && captchaKey && isSameOriginUrl(captchaKey) && isSameOriginForm(form)) {
      return { master, form, image, controls: captureControls(form), captchaKey }
    }
  }
  return null
}
