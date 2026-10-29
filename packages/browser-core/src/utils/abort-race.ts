export type RaceAbortOptions = Readonly<{
  /** Best-effort cleanup when abort wins; failures and pending cleanup cannot delay rejection. */
  onAbort?: () => void | PromiseLike<void>
}>

type AbortRejectionReason = Error | DOMException

function normalizeAbortReason(value: unknown, fallbackMessage: string): AbortRejectionReason {
  if (value instanceof Error || value instanceof DOMException) {
    return value
  }
  return new DOMException(fallbackMessage, 'AbortError')
}

function defaultAbortReason(signal: AbortSignal): AbortRejectionReason {
  return normalizeAbortReason(signal.reason, '操作已取消')
}

function isAbortSignal(value: AbortSignal | readonly AbortSignal[]): value is AbortSignal {
  return typeof value === 'object' && value !== null && 'aborted' in value
}

function runAbortCleanup(cleanup: RaceAbortOptions['onAbort']): void {
  if (!cleanup) return
  try {
    void Promise.resolve(cleanup()).catch(() => undefined)
  } catch {
    // 清理错误不得覆盖调用方取消，也不能使等待者永久悬挂。
  }
}

/**
 * Settles with `promise` unless one of `signals` aborts first; a late
 * underlying settlement or rejection after an abort win is ignored.
 */
export function raceAbort<T>(
  promise: PromiseLike<T>,
  signals: AbortSignal | readonly AbortSignal[] | undefined,
  createError?: () => unknown,
  options: RaceAbortOptions = {},
): Promise<T> {
  let watched: AbortSignal[]
  if (signals === undefined) {
    watched = []
  } else if (isAbortSignal(signals)) {
    watched = [signals]
  } else {
    watched = [...signals]
  }
  if (watched.length === 0) {
    return Promise.resolve(promise)
  }
  const buildReason = (): AbortRejectionReason => {
    if (createError) {
      try {
        return normalizeAbortReason(createError(), '操作已取消')
      } catch {
        // 自定义错误构造失败仍以信号原因结算。
      }
    }
    const aborted = watched.find((signal) => signal.aborted)
    return aborted ? defaultAbortReason(aborted) : new DOMException('操作已取消', 'AbortError')
  }
  const preAborted = watched.find((signal) => signal.aborted)
  if (preAborted) {
    const reason = buildReason()
    runAbortCleanup(options.onAbort)
    void Promise.resolve(promise).catch(() => undefined)
    return Promise.reject(reason)
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      for (const signal of watched) {
        signal.removeEventListener('abort', onAbort)
      }
    }
    const finish = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      callback()
    }
    const onAbort = (): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      const reason = buildReason()
      runAbortCleanup(options.onAbort)
      reject(reason)
    }
    for (const signal of watched) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
    void Promise.resolve(promise).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}
