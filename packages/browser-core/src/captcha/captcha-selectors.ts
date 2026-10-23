export const captchaSelectors = {
  form: 'form[name="riddleform"]',
  master: '#riddlemaster',
  submit: '#riddlesubmit',
  answers: 'input[name="riddleanswer[]"]',
} as const
