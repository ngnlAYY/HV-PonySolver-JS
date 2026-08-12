import {
  ANSWER_MODE_STORAGE_KEY,
  DEFAULT_ANSWER_MODE,
  DEFAULT_PANEL_HISTORY_LIMIT,
  DEFAULT_PANEL_POSITION,
  MULTI_CLICK_DELAY_STORAGE_KEY,
  PANEL_COMPACT_MODE_STORAGE_KEY,
  PANEL_HISTORY_LIMIT_STORAGE_KEY,
  PANEL_POSITION_STORAGE_KEY,
  RANDOM_ON_FAIL_STORAGE_KEY,
  SUBMIT_DELAY_STORAGE_KEY,
  clearModelAccessKey,
  getModelAccessKey,
  isAnswerMode,
  parseDelayRange,
  parsePanelHistoryLimit,
  parsePanelPosition,
  serializeDelayRange,
  serializePanelPosition,
  timingConfig,
} from '@hv-pony-solver/browser-core'

import { IndexedDbStringStorage } from '../host/indexeddb-string-storage'
import { runtimeConnect, storageGetAll, storageRemove, storageSet } from '../platform/webextension'
import {
  OPTIONS_PORT_NAME,
  PROTOCOL_VERSION,
  isHostResponse,
  isModelAccessKey,
  type HostRequest,
  type HostResponse,
  type HostSuccessResponse,
} from '../protocol/messages'

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) {
    throw new Error(`设置页缺少元素: ${id}`)
  }
  return found as T
}

const form = element<HTMLFormElement>('settings-form')
const answerMode = element<HTMLSelectElement>('answer-mode')
const submitDelay = element<HTMLInputElement>('submit-delay')
const multiClickDelay = element<HTMLInputElement>('multi-click-delay')
const panelPosition = element<HTMLInputElement>('panel-position')
const panelCompact = element<HTMLInputElement>('panel-compact')
const randomOnFail = element<HTMLInputElement>('random-on-fail')
const historyLimit = element<HTMLInputElement>('history-limit')
const modelKey = element<HTMLInputElement>('model-key')
const verifyKeyButton = element<HTMLButtonElement>('verify-key')
const clearKeyButton = element<HTMLButtonElement>('clear-key')
const status = element<HTMLOutputElement>('status')
const secretStorage = new IndexedDbStringStorage()

function setStatus(message: string, isError = false): void {
  status.textContent = message
  status.dataset.kind = isError ? 'error' : 'success'
}

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

async function load(): Promise<void> {
  const values = await storageGetAll()
  answerMode.value = isAnswerMode(values[ANSWER_MODE_STORAGE_KEY]) ? values[ANSWER_MODE_STORAGE_KEY] : DEFAULT_ANSWER_MODE
  submitDelay.value = typeof values[SUBMIT_DELAY_STORAGE_KEY] === 'string'
    ? values[SUBMIT_DELAY_STORAGE_KEY]
    : serializeDelayRange(timingConfig.submitDelay)
  multiClickDelay.value = typeof values[MULTI_CLICK_DELAY_STORAGE_KEY] === 'string'
    ? values[MULTI_CLICK_DELAY_STORAGE_KEY]
    : serializeDelayRange(timingConfig.multiClickDelay)
  panelPosition.value = typeof values[PANEL_POSITION_STORAGE_KEY] === 'string'
    ? values[PANEL_POSITION_STORAGE_KEY]
    : serializePanelPosition(DEFAULT_PANEL_POSITION)
  panelCompact.checked = values[PANEL_COMPACT_MODE_STORAGE_KEY] === '1'
  randomOnFail.checked = values[RANDOM_ON_FAIL_STORAGE_KEY] === undefined || values[RANDOM_ON_FAIL_STORAGE_KEY] === '1'
  historyLimit.value = typeof values[PANEL_HISTORY_LIMIT_STORAGE_KEY] === 'string'
    ? values[PANEL_HISTORY_LIMIT_STORAGE_KEY]
    : String(DEFAULT_PANEL_HISTORY_LIMIT)
  const hasKey = (await getModelAccessKey(secretStorage)).length > 0
  setStatus(hasKey ? '已配置模型 Key（不会回显）' : '尚未配置模型 Key')
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  void (async () => {
    try {
      if (!isAnswerMode(answerMode.value)) {
        throw new Error('答题模式无效')
      }
      const values = {
        [ANSWER_MODE_STORAGE_KEY]: answerMode.value,
        [SUBMIT_DELAY_STORAGE_KEY]: serializeDelayRange(parseDelayRange(submitDelay.value)),
        [MULTI_CLICK_DELAY_STORAGE_KEY]: serializeDelayRange(parseDelayRange(multiClickDelay.value)),
        [PANEL_POSITION_STORAGE_KEY]: serializePanelPosition(parsePanelPosition(panelPosition.value)),
        [PANEL_HISTORY_LIMIT_STORAGE_KEY]: String(parsePanelHistoryLimit(historyLimit.value)),
        [RANDOM_ON_FAIL_STORAGE_KEY]: randomOnFail.checked ? '1' : '0',
      }
      await storageSet(values)
      if (panelCompact.checked) {
        await storageSet({ [PANEL_COMPACT_MODE_STORAGE_KEY]: '1' })
      } else {
        await storageRemove(PANEL_COMPACT_MODE_STORAGE_KEY)
      }
      setStatus('设置已保存；已打开的游戏页面刷新后应用全部设置')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true)
    }
  })()
})

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
      setStatus('正在下载并校验模型…')
      await requestHost({
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: nextRequestId(),
        candidateKey,
      })
      modelKey.value = ''
      setStatus('模型 Key 验证成功并已安全保存')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true)
    }
  })()
})

clearKeyButton.addEventListener('click', () => {
  void clearModelAccessKey(secretStorage)
    .then(() => {
      modelKey.value = ''
      setStatus('模型 Key 已清除')
    })
    .catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error), true))
})

globalThis.addEventListener('pagehide', () => void secretStorage.close(), { once: true })
void load().catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error), true))
