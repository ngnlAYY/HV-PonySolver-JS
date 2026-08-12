export type ExtensionSender = Readonly<{
  id?: string
  url?: string
  tab?: Readonly<{ url?: string }>
}>

type ExtensionEvent<Listener> = Readonly<{
  addListener(listener: Listener): void
  removeListener(listener: Listener): void
}>

export interface ExtensionPort {
  readonly name: string
  readonly sender?: ExtensionSender
  readonly onMessage: ExtensionEvent<(message: unknown) => void>
  readonly onDisconnect: ExtensionEvent<() => void>
  postMessage(message: unknown): void
  disconnect(): void
}

export type RuntimeMessageListener = (
  message: unknown,
  sender: ExtensionSender,
  sendResponse: (response: unknown) => void,
) => boolean | void

export type StorageChanges = Readonly<Record<string, Readonly<{ oldValue?: unknown; newValue?: unknown }>>>

type RawRuntime = Readonly<{
  id: string
  lastError?: Readonly<{ message?: string }>
  getURL(path: string): string
  connect(connectInfo: Readonly<{ name: string }>): ExtensionPort
  onConnect: ExtensionEvent<(port: ExtensionPort) => void>
  onMessage: ExtensionEvent<RuntimeMessageListener>
  sendMessage(message: unknown, callback?: (response: unknown) => void): Promise<unknown> | void
  getContexts?: (filter: Readonly<{ contextTypes: string[]; documentUrls: string[] }>) => Promise<unknown[]>
  openOptionsPage(callback?: () => void): Promise<void> | void
}>

type RawStorageArea = Readonly<{
  get(keys?: string | string[] | null, callback?: (items: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void
  set(items: Record<string, unknown>, callback?: () => void): Promise<void> | void
  remove(keys: string | string[], callback?: () => void): Promise<void> | void
}>

type RawExtensionApi = Readonly<{
  runtime: RawRuntime
  storage: Readonly<{
    local: RawStorageArea
    onChanged: ExtensionEvent<(changes: StorageChanges, areaName: string) => void>
  }>
  offscreen?: Readonly<{
    createDocument(options: Readonly<{ url: string; reasons: string[]; justification: string }>): Promise<void>
  }>
  action: Readonly<{
    onClicked: ExtensionEvent<() => void>
  }>
}>

type ExtensionGlobals = typeof globalThis & {
  browser?: RawExtensionApi
  chrome?: RawExtensionApi
}

function globals(): ExtensionGlobals {
  return globalThis as ExtensionGlobals
}

function rawApi(): { api: RawExtensionApi; promiseStyle: boolean } {
  const extensionGlobals = globals()
  if (extensionGlobals.browser) {
    return { api: extensionGlobals.browser, promiseStyle: true }
  }
  if (extensionGlobals.chrome) {
    return { api: extensionGlobals.chrome, promiseStyle: false }
  }
  throw new Error('浏览器扩展 API 不可用')
}

function callbackError(runtime: RawRuntime): Error | null {
  const message = runtime.lastError?.message
  return message ? new Error(message) : null
}

export function runtimeId(): string {
  return rawApi().api.runtime.id
}

export function runtimeGetUrl(path: string): string {
  return rawApi().api.runtime.getURL(path)
}

export function runtimeConnect(name: string): ExtensionPort {
  return rawApi().api.runtime.connect({ name })
}

export function addRuntimeConnectListener(listener: (port: ExtensionPort) => void): () => void {
  const event = rawApi().api.runtime.onConnect
  event.addListener(listener)
  return () => event.removeListener(listener)
}

export function addRuntimeMessageListener(listener: RuntimeMessageListener): () => void {
  const event = rawApi().api.runtime.onMessage
  event.addListener(listener)
  return () => event.removeListener(listener)
}

export async function sendRuntimeMessage(message: unknown): Promise<unknown> {
  const { api, promiseStyle } = rawApi()
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

export async function storageGetAll(): Promise<Record<string, unknown>> {
  const { api, promiseStyle } = rawApi()
  if (promiseStyle) {
    return api.storage.local.get(null) as Promise<Record<string, unknown>>
  }
  return new Promise((resolve, reject) => {
    api.storage.local.get(null, (items) => {
      const error = callbackError(api.runtime)
      if (error) {
        reject(error)
        return
      }
      resolve(items)
    })
  })
}

export async function storageSet(items: Record<string, unknown>): Promise<void> {
  const { api, promiseStyle } = rawApi()
  if (promiseStyle) {
    await api.storage.local.set(items)
    return
  }
  await new Promise<void>((resolve, reject) => {
    api.storage.local.set(items, () => {
      const error = callbackError(api.runtime)
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export async function storageRemove(keys: string | string[]): Promise<void> {
  const { api, promiseStyle } = rawApi()
  if (promiseStyle) {
    await api.storage.local.remove(keys)
    return
  }
  await new Promise<void>((resolve, reject) => {
    api.storage.local.remove(keys, () => {
      const error = callbackError(api.runtime)
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export function addStorageChangeListener(listener: (changes: StorageChanges, areaName: string) => void): () => void {
  const event = rawApi().api.storage.onChanged
  event.addListener(listener)
  return () => event.removeListener(listener)
}

export type ChromiumOffscreenApi = Readonly<{
  getContexts(filter: Readonly<{ contextTypes: string[]; documentUrls: string[] }>): Promise<unknown[]>
  createDocument(options: Readonly<{ url: string; reasons: string[]; justification: string }>): Promise<void>
}>

export function getChromiumOffscreenApi(): ChromiumOffscreenApi {
  const extensionGlobals = globals()
  const api = extensionGlobals.chrome
  if (!api?.runtime.getContexts || !api.offscreen) {
    throw new Error('当前 Chromium 不支持 Offscreen Document')
  }
  return {
    getContexts: (filter) => api.runtime.getContexts!(filter),
    createDocument: (options) => api.offscreen!.createDocument(options),
  }
}

export function registerOpenOptionsAction(): () => void {
  const { api, promiseStyle } = rawApi()
  const listener = (): void => {
    if (promiseStyle) {
      void api.runtime.openOptionsPage()
      return
    }
    api.runtime.openOptionsPage(() => undefined)
  }
  api.action.onClicked.addListener(listener)
  return () => api.action.onClicked.removeListener(listener)
}
