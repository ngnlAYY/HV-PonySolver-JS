import { downloadModel as downloadCoreModel, type ModelIntegrityOptions } from '@hv-pony-solver/browser-core'

import { getModelAccessKey } from './model-settings'

export type { ModelDownloadEnvironment, ModelIntegrityOptions } from '@hv-pony-solver/browser-core'

type CombinedAbortSignal = Readonly<{
  signal: AbortSignal
  dispose(): void
}>

function combineAbortSignals(first: AbortSignal, second: AbortSignal): CombinedAbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([first, second]), dispose: () => undefined }
  }

  const controller = new AbortController()
  const abortFrom = (source: AbortSignal): (() => void) => () => controller.abort(source.reason)
  const abortFirst = abortFrom(first)
  const abortSecond = abortFrom(second)
  first.addEventListener('abort', abortFirst, { once: true })
  second.addEventListener('abort', abortSecond, { once: true })
  /* c8 ignore start -- the core deadline guard prevents this race through the public API. */
  if (first.aborted) {
    abortFirst()
  } else if (second.aborted) {
    abortSecond()
  }
  /* c8 ignore stop */

  return {
    signal: controller.signal,
    dispose(): void {
      first.removeEventListener('abort', abortFirst)
      second.removeEventListener('abort', abortSecond)
    },
  }
}

export function downloadModel(signal?: AbortSignal, options: ModelIntegrityOptions = {}): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    return Promise.reject(new Error('模型下载已取消'))
  }

  return downloadCoreModel(undefined, options, {
    fetchImpl: (input, init) => {
      const deadlineSignal = init?.signal
      if (signal && deadlineSignal) {
        const combined = combineAbortSignals(signal, deadlineSignal)
        return fetch(input, { ...init, signal: combined.signal }).finally(combined.dispose)
      }
      return fetch(input, { ...init, signal: signal ?? deadlineSignal } as RequestInit)
    },
    getAccessKey: () => getModelAccessKey().catch(() => ''),
  })
}
