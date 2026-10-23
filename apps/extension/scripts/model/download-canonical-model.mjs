import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const repositoryRoot = path.resolve(extensionRoot, '../..')
const canonicalIdentity = Object.freeze({
  filename: ORT_MODEL_FILENAME,
  byteLength: ORT_MODEL_INTEGRITY.byteLength,
  sha256: ORT_MODEL_INTEGRITY.sha256,
})
const HASH_CHUNK_BYTES = 1024 * 1024

export const DEFAULT_CANONICAL_MODEL_TIMEOUT_MS = 120_000

// Only errors constructed here have messages safe for command-line output.
class CanonicalModelError extends Error {}

function canonicalUrl(value) {
  if (!value) {
    throw new CanonicalModelError('PACKAGED_MODEL_URL is required for the canonical model gate')
  }
  let url
  try {
    if (typeof value !== 'string') throw new TypeError()
    url = new globalThis.URL(value)
  } catch {
    // URL parser errors can retain the complete input, including credentials.
    throw new CanonicalModelError('PACKAGED_MODEL_URL must be a valid HTTPS URL')
  }
  if (url.protocol !== 'https:') {
    throw new CanonicalModelError('PACKAGED_MODEL_URL must use HTTPS')
  }
  if (url.username || url.password) {
    throw new CanonicalModelError('PACKAGED_MODEL_URL must not contain credentials')
  }
  return url.href
}

function canonicalBearerToken(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value !== value.trim() || !/^[A-Za-z0-9._~+/-]+=*$/u.test(value)) {
    throw new CanonicalModelError('PACKAGED_MODEL_BEARER_TOKEN must be a valid Bearer token')
  }
  return value
}

function assertIdentity(identity) {
  if (!identity || !Number.isSafeInteger(identity.byteLength) || identity.byteLength <= 0) {
    throw new CanonicalModelError('Canonical model identity has an invalid byte length')
  }
  if (!/^[a-f0-9]{64}$/u.test(identity.sha256 ?? '')) {
    throw new CanonicalModelError('Canonical model identity has an invalid SHA-256')
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
    controller.abort(new CanonicalModelError(`${label} timed out after ${timeoutMs} ms`))
  }, timeoutMs)
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', forwardAbort)
    },
  }
}

function awaitWithSignal(operation, signal, label, onAbortedValue) {
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
          if (signal.aborted) {
            onAbortedValue?.(value)
            reject(abortError(signal, label))
            return
          }
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
  if (signal.aborted) cancelBody(response)
  throwIfAborted(signal, 'Canonical model download')
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    // Node fetch exposes Content-Encoding but returns decoded bytes. Bound the
    // wire declaration separately; the stream allocation stays at the model size.
    const encoding = response.headers.get('content-encoding')?.trim().toLowerCase()
    const encoded = encoding !== undefined && encoding !== 'identity'
    const maximumDeclaredLength = encoded
      ? identity.byteLength + Math.max(64 * 1024, Math.ceil(identity.byteLength / 1024))
      : identity.byteLength
    const parsedLength = /^\d+$/u.test(declaredLength) ? Number(declaredLength) : Number.NaN
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength <= 0 ||
      parsedLength > maximumDeclaredLength ||
      (!encoded && parsedLength !== identity.byteLength)
    ) {
      cancelBody(response)
      throw new CanonicalModelError(
        `Canonical model Content-Length mismatch: expected ${identity.byteLength}, received ${Number.isSafeInteger(parsedLength) ? parsedLength : 'invalid'}`,
      )
    }
  }
  if (!response.body) {
    throw new CanonicalModelError('Canonical model response body is unavailable')
  }

  const bytes = new Uint8Array(identity.byteLength)
  const reader = response.body.getReader()
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
        throw new CanonicalModelError('Canonical model body stream failed')
      }
      if (record.done) {
        complete = true
        break
      }
      const chunk = record.value
      if (!(chunk instanceof Uint8Array)) {
        throw new CanonicalModelError('Canonical model body stream returned a non-byte chunk')
      }
      total += chunk.byteLength
      if (total > identity.byteLength) {
        throw new CanonicalModelError(
          `Canonical model byte length exceeds ${identity.byteLength}: received at least ${total}`,
        )
      }
      // Snapshot each chunk before the next read can reuse its backing buffer.
      bytes.set(chunk, total - chunk.byteLength)
    }
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
    throw new CanonicalModelError(
      `Canonical model byte length mismatch: expected ${identity.byteLength}, received ${total}`,
    )
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
  const token = canonicalBearerToken(options.bearerToken ?? process.env.PACKAGED_MODEL_BEARER_TOKEN)
  const timeoutMs = options.timeoutMs ?? DEFAULT_CANONICAL_MODEL_TIMEOUT_MS
  const deadline = createDeadlineSignal(options.signal, timeoutMs, 'Canonical model download')
  try {
    let response
    try {
      response = await awaitWithSignal(
        () =>
          (options.fetchImpl ?? globalThis.fetch)(url, {
            headers: token ? { authorization: `Bearer ${token}` } : undefined,
            redirect: 'error',
            signal: deadline.signal,
          }),
        deadline.signal,
        'Canonical model download',
        cancelBody,
      )
    } catch {
      throwIfAborted(deadline.signal, 'Canonical model download')
      // Fetch errors and their nested causes can echo headers or the requested URL.
      throw new CanonicalModelError('Canonical model request failed')
    }
    if (!response.ok) {
      cancelBody(response)
      throw new CanonicalModelError(`Canonical model download failed with HTTP ${response.status}`)
    }
    const bytes = await readBoundedBody(response, identity, deadline.signal)
    const digest = await sha256WithSignal(bytes, deadline.signal)
    if (digest !== identity.sha256) {
      throw new CanonicalModelError(`Canonical model SHA-256 mismatch: expected ${identity.sha256}, received ${digest}`)
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
    throw new CanonicalModelError('PACKAGED_MODEL_BEARER_TOKEN is required by PACKAGED_MODEL_AUTH_REQUIRED')
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
  try {
    const result = await downloadCanonicalModel({ timeoutMs: DEFAULT_CANONICAL_MODEL_TIMEOUT_MS })
    process.stdout.write(
      `Downloaded canonical model ${result.identity.filename} (${result.identity.byteLength} bytes, ${result.identity.sha256})\n`,
    )
  } catch (error) {
    const message = error instanceof CanonicalModelError ? error.message : 'Canonical model download failed'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
