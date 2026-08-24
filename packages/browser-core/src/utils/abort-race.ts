export type RaceAbortOptions = Readonly<{
  /**
   * Builds the rejection reason when an abort wins the race. Defaults to the
   * aborted signal's own abort reason.
   */
  createError?: () => unknown
  /** Runs when an abort wins the race, before the rejection is delivered. */
  onAbort?: () => void
  /**
   * Returns true to leave the promise pending on abort; use only when the
   * underlying operation is guaranteed to settle on its own.
   */
  holdOnAbort?: () => boolean
}>

function defaultAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('操作已取消', 'AbortError')
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
  const watched: AbortSignal[] = Array.isArray(signals) ? [...signals] : signals ? [signals] : []
  if (watched.length === 0) {
    return Promise.resolve(promise)
  }
  const buildReason = (): unknown => {
    if (createError) {
      return createError()
    }
    const aborted = watched.find((signal) => signal.aborted)
    return aborted ? defaultAbortReason(aborted) : new DOMException('操作已取消', 'AbortError')
  }
  const hold = options.holdOnAbort ?? (() => false)
  const preAborted = watched.find((signal) => signal.aborted)
  if (preAborted && !hold()) {
    void Promise.resolve(promise).catch(() => undefined)
    return Promise.reject(buildReason())
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
      if (settled || hold()) {
        return
      }
      settled = true
      cleanup()
      options.onAbort?.()
      reject(buildReason())
    }
    for (const signal of watched) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
    void Promise.resolve(promise).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
    if (preAborted) {
      onAbort()
    }
  })
}
