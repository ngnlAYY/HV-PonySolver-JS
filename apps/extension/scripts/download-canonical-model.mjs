import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ORT_MODEL_FILENAME, ORT_MODEL_INTEGRITY } from '@hv-pony-solver/shared/ort-model'

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(extensionRoot, '../..')
const canonicalIdentity = Object.freeze({
  filename: ORT_MODEL_FILENAME,
  byteLength: ORT_MODEL_INTEGRITY.byteLength,
  sha256: ORT_MODEL_INTEGRITY.sha256,
})

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

async function cancelBody(response) {
  try {
    await response.body?.cancel()
  } catch {
    // Cleanup must not hide the primary download failure.
  }
}

async function readBoundedBody(response, identity) {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength) || Number(declaredLength) !== identity.byteLength) {
      await cancelBody(response)
      throw new Error(
        `Canonical model Content-Length mismatch: expected ${identity.byteLength}, received ${declaredLength}`,
      )
    }
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== identity.byteLength) {
      throw new Error(
        `Canonical model byte length mismatch: expected ${identity.byteLength}, received ${bytes.byteLength}`,
      )
    }
    return bytes
  }

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  let complete = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        complete = true
        break
      }
      if (!value) {
        continue
      }
      total += value.byteLength
      if (total > identity.byteLength) {
        throw new Error(
          `Canonical model byte length exceeds ${identity.byteLength}: received at least ${total}`,
        )
      }
      chunks.push(value)
    }
  } catch (error) {
    try {
      await reader.cancel()
    } catch {
      // Preserve the read/validation failure.
    }
    throw error
  } finally {
    if (!complete) {
      try {
        await reader.cancel()
      } catch {
        // Preserve the primary failure.
      }
    }
    reader.releaseLock()
  }
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

export async function fetchCanonicalModel(options = {}) {
  const identity = options.identity ?? canonicalIdentity
  const url = canonicalUrl(options.url ?? process.env.PACKAGED_MODEL_URL)
  const token = options.bearerToken ?? process.env.PACKAGED_MODEL_BEARER_TOKEN
  const response = await (options.fetchImpl ?? globalThis.fetch)(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    redirect: 'error',
    signal: options.signal,
  })
  if (!response.ok) {
    await cancelBody(response)
    throw new Error(`Canonical model download failed with HTTP ${response.status}`)
  }
  const bytes = await readBoundedBody(response, identity)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== identity.sha256) {
    throw new Error(`Canonical model SHA-256 mismatch: expected ${identity.sha256}, received ${digest}`)
  }
  return { bytes, identity: { ...identity }, url }
}

export async function downloadCanonicalModel(options = {}) {
  const authenticationRequired = options.authenticationRequired
    ?? process.env.PACKAGED_MODEL_AUTH_REQUIRED === 'true'
  const bearerToken = options.bearerToken ?? process.env.PACKAGED_MODEL_BEARER_TOKEN
  if (authenticationRequired && !bearerToken) {
    throw new Error('PACKAGED_MODEL_BEARER_TOKEN is required by PACKAGED_MODEL_AUTH_REQUIRED')
  }
  const downloaded = await fetchCanonicalModel({ ...options, bearerToken })
  const destination = options.destination
    ?? path.join(repositoryRoot, 'model', downloaded.identity.filename)
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
  const result = await downloadCanonicalModel()
  process.stdout.write(
    `Downloaded canonical model ${result.identity.filename} (${result.identity.byteLength} bytes, ${result.identity.sha256})\n`,
  )
}
