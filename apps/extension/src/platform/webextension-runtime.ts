import {
  callbackError,
  resolveRawExtensionApi,
  type ExtensionPort,
  type RuntimeMessageListener,
} from './webextension-api'

export function runtimeId(): string {
  return resolveRawExtensionApi().api.runtime.id
}

export function runtimeGetUrl(path: string): string {
  return resolveRawExtensionApi().api.runtime.getURL(path)
}

export function runtimeConnect(name: string): ExtensionPort {
  return resolveRawExtensionApi().api.runtime.connect({ name })
}

export function addRuntimeConnectListener(listener: (port: ExtensionPort) => void): () => void {
  const event = resolveRawExtensionApi().api.runtime.onConnect
  event.addListener(listener)
  return () => event.removeListener(listener)
}

export function addRuntimeMessageListener(listener: RuntimeMessageListener): () => void {
  const event = resolveRawExtensionApi().api.runtime.onMessage
  event.addListener(listener)
  return () => event.removeListener(listener)
}

export async function sendRuntimeMessage(message: unknown): Promise<unknown> {
  const { api, promiseStyle } = resolveRawExtensionApi()
  if (promiseStyle) {
    return api.runtime.sendMessage(message) as Promise<unknown>
  }
  return new Promise((resolve, reject) => {
    api.runtime.sendMessage(message, (response) => {
      const error = callbackError(api.runtime)
      if (error) {
        reject(error)
        return
      }
      resolve(response)
    })
  })
}
