import { clearModelAccessKey, getModelAccessKey } from '@hv-pony-solver/browser-core/model/model-settings'

import { IndexedDbStringStorage } from '../host/indexeddb-string-storage'
import { runtimeConnect } from '../platform/webextension'
import {
  OPTIONS_PORT_NAME,
  PROTOCOL_VERSION,
  isHostResponse,
  isModelAccessKey,
  type HostRequest,
  type HostResponse,
  type HostSuccessResponse,
} from '../protocol/messages'
import {
  createOptionsStatus,
  errorMessage,
  installOrdinarySettingsController,
  optionsElement,
} from './ordinary-settings'

const status = createOptionsStatus()
const ordinarySettings = installOrdinarySettingsController(status)
const keyFieldset = optionsElement<HTMLFieldSetElement>('model-key-fieldset')
const packagedModelHint = optionsElement<HTMLParagraphElement>('packaged-model-hint')
const modelKey = optionsElement<HTMLInputElement>('model-key')
const verifyKeyButton = optionsElement<HTMLButtonElement>('verify-key')
const clearKeyButton = optionsElement<HTMLButtonElement>('clear-key')
const secretStorage = new IndexedDbStringStorage()

function nextRequestId(): string {
  return `options-${Date.now().toString(36)}`
}

function requestHost(request: HostRequest): Promise<HostSuccessResponse> {
  return new Promise<HostResponse>((resolve, reject) => {
    const port = runtimeConnect(OPTIONS_PORT_NAME)
    let settled = false
    const timeoutId = setTimeout(() => {
      settled = true
      port.disconnect()
      reject(new Error('Key 验证超时'))
    }, 95_000)
    port.onMessage.addListener((message) => {
      if (!isHostResponse(message) || message.requestId !== request.requestId) {
        return
      }
      settled = true
      clearTimeout(timeoutId)
      port.disconnect()
      resolve(message)
    })
    port.onDisconnect.addListener(() => {
      clearTimeout(timeoutId)
      if (!settled) {
        settled = true
        reject(new Error('Key 验证连接已断开'))
      }
    })
    port.postMessage(request)
  }).then((response) => {
    if (!response.ok) {
      throw new Error(response.error)
    }
    return response
  })
}

verifyKeyButton.addEventListener('click', () => {
  void (async () => {
    try {
      const candidateKey = modelKey.value.trim() || (await getModelAccessKey(secretStorage))
      if (!candidateKey) {
        throw new Error('请先输入模型 Key')
      }
      if (!isModelAccessKey(candidateKey)) {
        throw new Error('模型 Key 必须是 64 位十六进制字符串')
      }
      status.set('正在下载并校验模型…')
      await requestHost({
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: nextRequestId(),
        candidateKey,
      })
      modelKey.value = ''
      status.set('模型 Key 验证成功并已安全保存')
    } catch (error) {
      status.set(errorMessage(error), true)
    }
  })()
})

clearKeyButton.addEventListener('click', () => {
  void clearModelAccessKey(secretStorage)
    .then(() => {
      modelKey.value = ''
      status.set('模型 Key 已清除')
    })
    .catch((error: unknown) => status.set(errorMessage(error), true))
})

// Install every Key handler before exposing the controls to remote-artifact users.
keyFieldset.disabled = false
packagedModelHint.hidden = true

globalThis.addEventListener('pagehide', () => void secretStorage.close(), { once: true })
void ordinarySettings.load()
  .then(async () => {
    const hasKey = (await getModelAccessKey(secretStorage)).length > 0
    status.set(hasKey ? '已配置模型 Key（不会回显）' : '尚未配置模型 Key')
  })
  .catch((error: unknown) => status.set(errorMessage(error), true))
