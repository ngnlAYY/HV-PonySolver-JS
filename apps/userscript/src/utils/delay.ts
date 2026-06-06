export function randDelay(range: readonly [number, number]): number {
  const min = range[0]
  const max = range[1]
  return min + Math.floor(Math.random() * (max - min + 1))
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const cleanup = (): void => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      signal?.removeEventListener('abort', handleAbort)
    }
    const finish = (): void => {
      cleanup()
      resolve()
    }
    const handleAbort = (): void => finish()

    timeoutId = setTimeout(finish, ms)
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

export function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const current = result[i] as T
    result[i] = result[j] as T
    result[j] = current
  }
  return result
}
