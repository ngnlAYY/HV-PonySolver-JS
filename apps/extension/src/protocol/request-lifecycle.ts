export type RequestLifecycle<T> = Readonly<{
  settled: boolean
  start(): void
  resolve(value: T): void
  reject(error: Error): void
}>

type LifecycleOptions = Readonly<{
  signal: AbortSignal | undefined
  timeoutMs: number
  timeoutError: () => Error
  abortError: () => Error
  cleanup: () => void
  onAbandon?: () => void
}>

/** 只统一请求结算与资源清理；连接共享、响应校验和远端取消仍由各适配器负责。 */
export function createRequestLifecycle<T>(
  resolve: (value: T) => void,
  reject: (error: Error) => void,
  options: LifecycleOptions,
): RequestLifecycle<T> {
  let settled = false
  let started = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  const finish = (complete: () => void): void => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
    try {
      options.cleanup()
    } finally {
      complete()
    }
  }
  const abandon = (error: Error): void =>
    finish(() => {
      try {
        options.onAbandon?.()
      } finally {
        reject(error)
      }
    })
  const onAbort = (): void => abandon(options.abortError())
  return {
    get settled() {
      return settled
    },
    start(): void {
      if (started || settled) return
      started = true
      timeout = setTimeout(() => abandon(options.timeoutError()), options.timeoutMs)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      // 调用方先发布 pending 条目及监听器，再启动，覆盖监听注册期间的取消。
      if (options.signal?.aborted) onAbort()
    },
    resolve: (value) => finish(() => resolve(value)),
    reject: (error) => finish(() => reject(error)),
  }
}
