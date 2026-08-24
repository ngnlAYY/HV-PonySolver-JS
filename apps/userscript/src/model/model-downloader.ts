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

/**
 * Polyfill path only: keeps forwarding caller/deadline aborts for as long as
 * the response body is being consumed and releases the listeners exactly when
 * the body settles — not already when the response headers arrive, which used
 * to strand body reads on environments without AbortSignal.any.
 */
async function fetchWithBodyLifetimeAborts(
  input: RequestInfo | URL,
  init: RequestInit,
  combined: CombinedAbortSignal,
): Promise<Response> {
  let response: Response
  try {
    response = await fetch(input, { ...init, signal: combined.signal })
  } catch (error) {
    combined.dispose()
    throw error
  }
  const body = response.body
  if (!body) {
    combined.dispose()
    return response
  }
  const reader = body.getReader()
  const forwardedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          combined.dispose()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        combined.dispose()
        controller.error(error)
      }
    },
    cancel(reason) {
      combined.dispose()
      return reader.cancel(reason)
    },
  })
  return new Response(forwardedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export function downloadModel(signal?: AbortSignal, options: ModelIntegrityOptions = {}): Promise<ArrayBuffer> {
  if (signal?.aborted) {
    return Promise.reject(new Error('模型下载已取消'))
  }

  return downloadCoreModel(undefined, options, {
    fetchImpl: (input, init) => {
      const deadlineSignal = init?.signal
      if (!signal || !deadlineSignal) {
        return fetch(input, { ...init, signal: signal ?? deadlineSignal } as RequestInit)
      }
      if (typeof AbortSignal.any === 'function') {
        // Composite signals keep forwarding caller aborts to the body for its
        // whole lifetime; their dispose step is a no-op.
        return fetch(input, { ...init, signal: combineAbortSignals(signal, deadlineSignal).signal })
      }
      const combined = combineAbortSignals(signal, deadlineSignal)
      return fetchWithBodyLifetimeAborts(input, { ...init, signal: combined.signal }, combined)
    },
    getAccessKey: () => getModelAccessKey().catch(() => ''),
  })
}
