import { MODEL_ACCESS_KEY_STORAGE_KEY } from '@hv-pony-solver/browser-core/model/model-settings'

import { IndexedDbStringStorage } from '../host/indexeddb-string-storage'
import { runtimeConnect } from '../platform/webextension'
import {
  OPTIONS_PORT_NAME,
  PROTOCOL_VERSION,
  isHostResponse,
  isModelAccessKey,
  type HostResponse,
  type HostSuccessResponse,
  type VerifyKeyRequest,
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
let requestSequence = 0
let keyGeneration = 0
let keyOperationTail: Promise<void> = Promise.resolve()
let activeKeyController: AbortController | null = null

function nextRequestId(): string {
  requestSequence += 1
  return `options-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

export function requestHost(
  request: VerifyKeyRequest,
  options: Readonly<{ signal?: AbortSignal; timeoutMs?: number }> = {},
): Promise<HostSuccessResponse> {
  const { signal, timeoutMs = 95_000 } = options
  if (signal?.aborted) {
    return Promise.reject(new Error('Key 验证已取消'))
  }
  return new Promise<HostResponse>((resolve, reject) => {
    const port = runtimeConnect(OPTIONS_PORT_NAME)
    let settled = false
    let disconnected = false
    const disconnect = (): void => {
      if (disconnected) {
        return
      }
      disconnected = true
      try {
        port.disconnect()
      } catch {
        // The request is already settled locally.
      }
    }
    const cleanup = (): void => {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      port.onMessage.removeListener(onMessage)
      port.onDisconnect.removeListener(onDisconnect)
    }
    const settle = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      disconnect()
      callback()
    }
    const onAbort = (): void => settle(() => reject(new Error('Key 验证已取消')))
    const onMessage = (message: unknown): void => {
      if (!isHostResponse(message) || message.requestId !== request.requestId) {
        return
      }
      settle(() => resolve(message))
    }
    const onDisconnect = (): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(new Error('Key 验证连接已断开'))
    }
    const timeoutId = setTimeout(() => {
      settle(() => reject(new Error('Key 验证超时')))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(onDisconnect)
    try {
      port.postMessage(request)
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))))
    }
    if (signal?.aborted) {
      onAbort()
    }
  }).then((response) => {
    if (!response.ok) {
      throw new Error(response.error)
    }
    return response
  })
}

function isCurrentOperation(generation: number, signal: AbortSignal): boolean {
  return generation === keyGeneration && !signal.aborted
}

function assertCurrentOperation(generation: number, signal: AbortSignal): void {
  if (!isCurrentOperation(generation, signal)) {
    throw new Error('Key 验证已取消')
  }
}

function enqueueKeyOperation(
  operation: (signal: AbortSignal, generation: number) => Promise<void>,
  pendingStatus?: string,
): void {
  keyGeneration += 1
  const generation = keyGeneration
  activeKeyController?.abort()
  const controller = new AbortController()
  activeKeyController = controller
  if (pendingStatus) {
    status.set(pendingStatus)
  }
  keyOperationTail = keyOperationTail
    .catch(() => undefined)
    .then(async () => {
      if (!isCurrentOperation(generation, controller.signal)) {
        return
      }
      try {
        await operation(controller.signal, generation)
      } catch (error) {
        if (isCurrentOperation(generation, controller.signal)) {
          status.set(errorMessage(error), true)
        }
      } finally {
        if (activeKeyController === controller) {
          activeKeyController = null
        }
      }
    })
}

verifyKeyButton.addEventListener('click', () => {
  enqueueKeyOperation(async (signal, generation) => {
    const storedKey = await secretStorage.get(MODEL_ACCESS_KEY_STORAGE_KEY, signal)
    assertCurrentOperation(generation, signal)
    const candidateKey = modelKey.value.trim() || storedKey?.trim() || ''
    if (!candidateKey) {
      throw new Error('请先输入模型 Key')
    }
    if (!isModelAccessKey(candidateKey)) {
      throw new Error('模型 Key 必须是 64 位十六进制字符串')
    }
    if (isCurrentOperation(generation, signal)) {
      status.set('正在下载并校验模型…')
    }
    await requestHost(
      {
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: nextRequestId(),
        candidateKey,
      },
      { signal },
    )
    assertCurrentOperation(generation, signal)
    modelKey.value = ''
    status.set('模型 Key 验证成功并已安全保存')
  })
})

clearKeyButton.addEventListener('click', () => {
  enqueueKeyOperation(
    async (signal, generation) => {
      await secretStorage.remove(MODEL_ACCESS_KEY_STORAGE_KEY, signal)
      assertCurrentOperation(generation, signal)
      modelKey.value = ''
      status.set('模型 Key 已清除')
    },
    '正在清除模型 Key…',
  )
})

// Install every Key handler before exposing the controls to remote-artifact users.
keyFieldset.disabled = false
packagedModelHint.hidden = true

globalThis.addEventListener(
  'pagehide',
  () => {
    keyGeneration += 1
    activeKeyController?.abort()
    activeKeyController = null
    keyOperationTail = keyOperationTail.catch(() => undefined).then(() => secretStorage.close())
  },
  { once: true },
)
const initialKeyGeneration = keyGeneration
void ordinarySettings.load()
  .then(async () => {
    const hasKey = ((await secretStorage.get(MODEL_ACCESS_KEY_STORAGE_KEY)) ?? '').trim().length > 0
    if (keyGeneration === initialKeyGeneration) {
      status.set(hasKey ? '已配置模型 Key（不会回显）' : '尚未配置模型 Key')
    }
  })
  .catch((error: unknown) => {
    if (keyGeneration === initialKeyGeneration) {
      status.set(errorMessage(error), true)
    }
  })
