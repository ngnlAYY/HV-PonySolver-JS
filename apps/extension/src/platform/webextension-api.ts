export type ExtensionSender = Readonly<{
  id?: string
  url?: string
  tab?: Readonly<{ url?: string }>
}>

export type ExtensionEvent<Listener> = Readonly<{
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

export type RawRuntime = Readonly<{
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

export type RawStorageArea = Readonly<{
  get(
    keys?: string | string[] | null,
    callback?: (items: Record<string, unknown>) => void,
  ): Promise<Record<string, unknown>> | void
  set(items: Record<string, unknown>, callback?: () => void): Promise<void> | void
  remove(keys: string | string[], callback?: () => void): Promise<void> | void
}>

export type RawExtensionApi = Readonly<{
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

export function resolveRawExtensionApi(): { api: RawExtensionApi; promiseStyle: boolean } {
  const extensionGlobals = globalThis as ExtensionGlobals
  if (extensionGlobals.browser) {
    return { api: extensionGlobals.browser, promiseStyle: true }
  }
  if (extensionGlobals.chrome) {
    return { api: extensionGlobals.chrome, promiseStyle: false }
  }
  throw new Error('浏览器扩展 API 不可用')
}

export function callbackError(runtime: RawRuntime): Error | null {
  const message = runtime.lastError?.message
  return message ? new Error(message) : null
}
