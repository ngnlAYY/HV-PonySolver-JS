import { captchaSelectors } from './captcha-selectors'

export type CaptchaTarget = Readonly<{
  master: Element
  form: HTMLFormElement
  image: HTMLImageElement
  captchaKey: string
}>

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
      return { master, form, image, captchaKey }
    }
  }
  return null
}
