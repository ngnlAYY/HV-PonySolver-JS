import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(extensionRoot, '../..')
const canonicalIdentity = Object.freeze({
  filename: ORT_MODEL_FILENAME,
  byteLength: ORT_MODEL_INTEGRITY.byteLength,
  sha256: ORT_MODEL_INTEGRITY.sha256,
})
const HASH_CHUNK_BYTES = 1024 * 1024

export const DEFAULT_CANONICAL_MODEL_TIMEOUT_MS = 120_000

function canonicalUrl(value) {
  if (!value) {
    throw new Error('PACKAGED_MODEL_URL is required for the canonical model gate')
  }
  const url = new globalThis.URL(value)
  if (url.protocol !== 'https:') {
    throw new Error('PACKAGED_MODEL_URL must use HTTPS')
  }
  return url.href
}

function assertIdentity(identity) {
  if (!identity || !Number.isSafeInteger(identity.byteLength) || identity.byteLength <= 0) {
    throw new Error('Canonical model identity has an invalid byte length')
  }
  if (!/^[a-f0-9]{64}$/u.test(identity.sha256 ?? '')) {
    throw new Error('Canonical model identity has an invalid SHA-256')
  }
}

function abortError(signal, label) {
  return signal.reason instanceof Error ? signal.reason : new Error(`${label} was aborted`, { cause: signal.reason })
}

function throwIfAborted(signal, label) {
  if (signal.aborted) {
    throw abortError(signal, label)
  }
}

function createDeadlineSignal(callerSignal, timeoutMs, label) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new RangeError(`${label} timeout must be a positive 32-bit integer`)
  }
  const controller = new globalThis.AbortController()
  const forwardAbort = () => controller.abort(callerSignal.reason)
  if (callerSignal?.aborted) {
    forwardAbort()
  } else {
    callerSignal?.addEventListener('abort', forwardAbort, { once: true })
  }
  const timer = setTimeout(() => {
    controller.abort(new Error(`${label} timed out after ${timeoutMs} ms`))
  }, timeoutMs)
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', forwardAbort)
    },
  }
}

function awaitWithSignal(operation, signal, label) {
  throwIfAborted(signal, label)
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(abortError(signal, label))
    }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          signal.removeEventListener('abort', abort)
          resolve(value)
        },
        (error) => {
          signal.removeEventListener('abort', abort)
          reject(error)
        },
      )
  })
}

function cancelBody(response) {
  try {
    const cancellation = response.body?.cancel()
    if (cancellation) {
      void cancellation.catch(() => undefined)
    }
  } catch {
    // Cleanup must not hide the primary download failure.
  }
}

function cancelReader(reader) {
  try {
    void reader.cancel().catch(() => undefined)
  } catch {
    // Cleanup must not hide the primary download failure.
  }
}

async function readBoundedBody(response, identity, signal) {
  throwIfAborted(signal, 'Canonical model download')
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const parsedLength = /^\d+$/u.test(declaredLength) ? Number(declaredLength) : Number.NaN
    if (!Number.isSafeInteger(parsedLength) || parsedLength !== identity.byteLength) {
      cancelBody(response)
      throw new Error(
        `Canonical model Content-Length mismatch: expected ${identity.byteLength}, received ${declaredLength}`,
      )
    }
  }
  if (!response.body) {
    throw new Error('Canonical model response body is unavailable')
  }

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  let complete = false
  try {
    while (true) {
      let record
      try {
        record = await awaitWithSignal(() => reader.read(), signal, 'Canonical model download')
      } catch (error) {
        if (signal.aborted) {
          throw error
        }
        throw new Error('Canonical model body stream failed', { cause: error })
      }
      if (record.done) {
        complete = true
        break
      }
      const chunk = record.value
      if (!(chunk instanceof Uint8Array)) {
        throw new Error('Canonical model body stream returned a non-byte chunk')
      }
      total += chunk.byteLength
      if (total > identity.byteLength) {
        throw new Error(`Canonical model byte length exceeds ${identity.byteLength}: received at least ${total}`)
      }
      chunks.push(chunk)
    }
  } catch (error) {
    cancelReader(reader)
    throw error
  } finally {
    if (!complete) {
      cancelReader(reader)
    }
    try {
      reader.releaseLock()
    } catch {
      // An interrupted read can retain its lock until cancellation settles.
    }
  }
  throwIfAborted(signal, 'Canonical model download')
  if (total !== identity.byteLength) {
    throw new Error(`Canonical model byte length mismatch: expected ${identity.byteLength}, received ${total}`)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function sha256WithSignal(bytes, signal) {
  const effectiveSignal = signal ?? new globalThis.AbortController().signal
  const hash = createHash('sha256')
  for (let offset = 0; offset < bytes.byteLength; offset += HASH_CHUNK_BYTES) {
    throwIfAborted(effectiveSignal, 'Canonical model hash')
    hash.update(bytes.subarray(offset, Math.min(offset + HASH_CHUNK_BYTES, bytes.byteLength)))
    await yieldToEventLoop()
  }
  throwIfAborted(effectiveSignal, 'Canonical model hash')
  return hash.digest('hex')
}

export async function fetchCanonicalModel(options = {}) {
  const identity = options.identity ?? canonicalIdentity
  assertIdentity(identity)
  const url = canonicalUrl(options.url ?? process.env.PACKAGED_MODEL_URL)
  const token = options.bearerToken ?? process.env.PACKAGED_MODEL_BEARER_TOKEN
  const timeoutMs = options.timeoutMs ?? DEFAULT_CANONICAL_MODEL_TIMEOUT_MS
  const deadline = createDeadlineSignal(options.signal, timeoutMs, 'Canonical model download')
  try {
    const response = await awaitWithSignal(
      () =>
        (options.fetchImpl ?? globalThis.fetch)(url, {
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
          redirect: 'error',
          signal: deadline.signal,
        }),
      deadline.signal,
      'Canonical model download',
    )
    if (!response.ok) {
      cancelBody(response)
      throw new Error(`Canonical model download failed with HTTP ${response.status}`)
    }
    const bytes = await readBoundedBody(response, identity, deadline.signal)
    const digest = await sha256WithSignal(bytes, deadline.signal)
    if (digest !== identity.sha256) {
      throw new Error(`Canonical model SHA-256 mismatch: expected ${identity.sha256}, received ${digest}`)
    }
    return { bytes, identity: { ...identity }, url }
  } finally {
    deadline.cleanup()
  }
}

export async function downloadCanonicalModel(options = {}) {
  const authenticationRequired = options.authenticationRequired ?? process.env.PACKAGED_MODEL_AUTH_REQUIRED === 'true'
  const bearerToken = options.bearerToken ?? process.env.PACKAGED_MODEL_BEARER_TOKEN
  if (authenticationRequired && !bearerToken) {
    throw new Error('PACKAGED_MODEL_BEARER_TOKEN is required by PACKAGED_MODEL_AUTH_REQUIRED')
  }
  const downloaded = await fetchCanonicalModel({ ...options, bearerToken })
  const destination = options.destination ?? path.join(repositoryRoot, 'model', downloaded.identity.filename)
  await mkdir(path.dirname(destination), { recursive: true })
  const temporaryPath = `${destination}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, downloaded.bytes, { flag: 'wx', mode: 0o600 })
    await rename(temporaryPath, destination)
  } finally {
    await rm(temporaryPath, { force: true })
  }
  return { ...downloaded, destination }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  const result = await downloadCanonicalModel({ timeoutMs: DEFAULT_CANONICAL_MODEL_TIMEOUT_MS })
  process.stdout.write(
    `Downloaded canonical model ${result.identity.filename} (${result.identity.byteLength} bytes, ${result.identity.sha256})\n`,
  )
}
