import {
  createOptionsStatus,
  errorMessage,
  installOrdinarySettingsController,
  optionsElement,
} from './ordinary-settings'

export const PACKAGED_MODEL_HINT = '当前版本已内置模型，无需配置模型 Key。'

const status = createOptionsStatus()
const keyFieldset = optionsElement<HTMLFieldSetElement>('model-key-fieldset')
const packagedModelHint = optionsElement<HTMLParagraphElement>('packaged-model-hint')

keyFieldset.disabled = true
packagedModelHint.textContent = PACKAGED_MODEL_HINT
packagedModelHint.hidden = false

const ordinarySettings = installOrdinarySettingsController(status)
void ordinarySettings.load().catch((error: unknown) => status.set(errorMessage(error), true))
