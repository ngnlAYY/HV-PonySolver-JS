import { captchaSelectors } from './captcha-selectors'

export type CaptchaControlsSnapshot = Readonly<{
  answers: readonly HTMLInputElement[]
  answerDisabled: readonly boolean[]
  answerTypes: readonly string[]
  answerForms: readonly (HTMLFormElement | null)[]
  submit: HTMLInputElement | null
  submitForm: HTMLFormElement | null
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
  imageSource: CaptchaImageSource
  controls: CaptchaControlsSnapshot
  captchaKey: string
}>

type PictureSource = Readonly<{
  element: HTMLSourceElement
  srcset: string
  sizes: string
  media: string
  type: string
}>

type CaptchaImageSource = Readonly<{
  src: string
  srcset: string
  sizes: string
  picture: HTMLPictureElement | null
  sources: readonly PictureSource[]
}>

function captureImageSource(image: HTMLImageElement): CaptchaImageSource {
  const picture = image.parentElement instanceof HTMLPictureElement ? image.parentElement : null
  const sources: PictureSource[] = []
  if (picture) {
    for (const child of Array.from(picture.children)) {
      if (child === image) break
      if (child instanceof HTMLSourceElement) {
        sources.push({ element: child, srcset: child.srcset, sizes: child.sizes, media: child.media, type: child.type })
      }
    }
  }
  return { src: image.src, srcset: image.srcset, sizes: image.sizes, picture, sources }
}

function isSameImageSource(left: CaptchaImageSource, right: CaptchaImageSource): boolean {
  return (
    left.src === right.src &&
    left.srcset === right.srcset &&
    left.sizes === right.sizes &&
    left.picture === right.picture &&
    left.sources.length === right.sources.length &&
    left.sources.every((source, index) => {
      const other = right.sources[index]
      return (
        other !== undefined &&
        source.element === other.element &&
        source.srcset === other.srcset &&
        source.sizes === other.sizes &&
        source.media === other.media &&
        source.type === other.type
      )
    })
  )
}

function captureControls(form: HTMLFormElement): CaptchaControlsSnapshot {
  const answers = Array.from(form.querySelectorAll<HTMLInputElement>(captchaSelectors.answers))
  const submit = form.querySelector<HTMLInputElement>(captchaSelectors.submit)
  return {
    answers,
    answerDisabled: answers.map((answer) => answer.matches(':disabled')),
    answerTypes: answers.map((answer) => answer.type),
    answerForms: answers.map((answer) => answer.form),
    submit,
    submitForm: submit?.form ?? null,
    submitDisabled: submit?.matches(':disabled') ?? false,
    submitType: submit?.type ?? null,
    submitAction: getSubmissionAction(form, submit),
  }
}

function isSameControls(left: CaptchaControlsSnapshot, right: CaptchaControlsSnapshot): boolean {
  return (
    left.submit === right.submit &&
    left.submitForm === right.submitForm &&
    left.submitType === right.submitType &&
    left.submitAction === right.submitAction &&
    left.answers.length === right.answers.length &&
    left.answers.every(
      (answer, index) =>
        answer === right.answers[index] &&
        left.answerForms[index] === right.answerForms[index] &&
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
    isSameImageSource(left.imageSource, right.imageSource) &&
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
    if (!image) continue
    const imageSource = captureImageSource(image)
    const responsive =
      imageSource.srcset.trim() !== '' || imageSource.sources.some((source) => source.srcset.trim() !== '')
    // 响应式选源可能暂时清空或保留旧 currentSrc；加载完成前不能退回旧 src 答题。
    if (responsive && (!image.complete || !image.currentSrc)) continue
    const captchaKey = responsive ? image.currentSrc : imageSource.src
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
        imageSource,
        controls,
        captchaKey,
      }
    }
  }
  return null
}
