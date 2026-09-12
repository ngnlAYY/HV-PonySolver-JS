import { captchaSelectors } from './captcha-selectors'

export type CaptchaControlsSnapshot = Readonly<{
  answers: readonly HTMLInputElement[]
  answerDisabled: readonly boolean[]
  answerTypes: readonly string[]
  submit: HTMLInputElement | null
  submitDisabled: boolean
  submitType: string | null
  submitAction: string | null
}>

export type CaptchaTarget = Readonly<{
  master: Element
  form: HTMLFormElement
  formAction: string
  pageUrl: string
  image: HTMLImageElement
  controls: CaptchaControlsSnapshot
  captchaKey: string
}>

function captureControls(form: HTMLFormElement): CaptchaControlsSnapshot {
  const answers = Array.from(form.querySelectorAll<HTMLInputElement>(captchaSelectors.answers))
  const submit = form.querySelector<HTMLInputElement>(captchaSelectors.submit)
  return {
    answers,
    answerDisabled: answers.map((answer) => answer.matches(':disabled')),
    answerTypes: answers.map((answer) => answer.type),
    submit,
    submitDisabled: submit?.matches(':disabled') ?? false,
    submitType: submit?.type ?? null,
    submitAction: getSubmissionAction(form, submit),
  }
}

function isSameControls(left: CaptchaControlsSnapshot, right: CaptchaControlsSnapshot): boolean {
  return (
    left.submit === right.submit &&
    left.submitType === right.submitType &&
    left.submitAction === right.submitAction &&
    left.answers.length === right.answers.length &&
    left.answers.every(
      (answer, index) =>
        answer === right.answers[index] &&
        left.answerDisabled[index] === right.answerDisabled[index] &&
        left.answerTypes[index] === right.answerTypes[index],
    )
  )
}

export function isSameCaptchaTarget(left: CaptchaTarget | null, right: CaptchaTarget | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.master === right.master &&
    left.form === right.form &&
    left.formAction === right.formAction &&
    left.pageUrl === right.pageUrl &&
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

export function getSubmissionAction(form: HTMLFormElement, submit: HTMLInputElement | null): string | null {
  if (!submit || !['submit', 'image'].includes(submit.type) || !submit.hasAttribute('formaction')) {
    return form.action
  }
  const override = submit.getAttribute('formaction') ?? ''
  // 显式空 formaction 使用文档地址，不继承 form.action 或 base 的地址。
  if (override === '') return form.ownerDocument.URL
  try {
    return new URL(override, form.ownerDocument.baseURI).href
  } catch {
    return null
  }
}

export function isSameOriginForm(form: HTMLFormElement, submit: HTMLInputElement | null = null): boolean {
  const submissionAction = getSubmissionAction(form, submit)
  return (
    (!form.action || isSameOriginUrl(form.action)) && submissionAction !== null && isSameOriginUrl(submissionAction)
  )
}

export function findCaptchaTarget(): CaptchaTarget | null {
  const masters = document.querySelectorAll(captchaSelectors.master)
  for (let index = 0; index < masters.length; index += 1) {
    const master = masters.item(index)
    const imageContainer = master.querySelector<HTMLElement>('[id="riddleimage"]')
    const image = imageContainer?.querySelector<HTMLImageElement>('img')
    const form = master.querySelector<HTMLFormElement>(captchaSelectors.form)
    const captchaKey = image?.currentSrc || image?.src || ''
    const controls = form ? captureControls(form) : null
    if (
      form &&
      controls &&
      image &&
      captchaKey &&
      isSameOriginUrl(captchaKey) &&
      isSameOriginForm(form, controls.submit)
    ) {
      return {
        master,
        form,
        formAction: form.action,
        pageUrl: location.href,
        image,
        controls,
        captchaKey,
      }
    }
  }
  return null
}
