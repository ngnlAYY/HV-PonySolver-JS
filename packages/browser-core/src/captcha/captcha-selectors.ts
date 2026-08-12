export const captchaSelectors = {
  form: 'form[name="riddleform"]',
  image: '#riddleimage img',
  master: '#riddlemaster',
  submit: '#riddlesubmit',
  answers: 'input[name="riddleanswer[]"]',
} as const
