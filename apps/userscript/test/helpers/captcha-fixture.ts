export type CaptchaFixture = HTMLDivElement & { submitButton: HTMLInputElement }

export function appendCaptcha(src = '/captcha.png'): CaptchaFixture {
  const captcha = document.createElement('div')
  captcha.id = 'riddlemaster'
  const form = document.createElement('form')
  form.name = 'riddleform'
  for (let i = 0; i < 6; i += 1) {
    const answer = document.createElement('input')
    answer.name = 'riddleanswer[]'
    answer.type = 'checkbox'
    form.appendChild(answer)
  }
  const submit = document.createElement('input')
  submit.id = 'riddlesubmit'
  submit.type = 'button'
  form.appendChild(submit)
  const imageContainer = document.createElement('div')
  imageContainer.id = 'riddleimage'
  const image = document.createElement('img')
  image.src = src
  imageContainer.appendChild(image)
  captcha.append(form, imageContainer)
  document.body.appendChild(captcha)
  return Object.assign(captcha, { submitButton: submit })
}
