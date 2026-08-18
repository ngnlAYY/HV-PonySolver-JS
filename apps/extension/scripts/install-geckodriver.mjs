import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, chmod, lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { browserSupport, parseGeckodriverVersion } from './browser-support.mjs'

const execFileAsync = promisify(execFile)
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDirectory, '..')
const repositoryRoot = path.resolve(extensionRoot, '../..')
const HASH_CHUNK_BYTES = 1024 * 1024

export const DEFAULT_GECKODRIVER_TIMEOUT_MS = 60_000
export const MAX_GECKODRIVER_ARCHIVE_BYTES = 32 * 1024 * 1024

function isPathWithin(candidate, root) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function canonicalizePotentialPath(candidate) {
  const resolved = path.resolve(candidate)
  const missingSegments = []
  let current = resolved
  while (true) {
    try {
      const canonicalParent = await realpath(current)
      return path.join(canonicalParent, ...missingSegments.reverse())
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error(`Unable to canonicalize geckodriver output path: ${resolved}`, { cause: error })
      }
      const parent = path.dirname(current)
      if (parent === current) {
        throw new Error(`Unable to canonicalize geckodriver output path: ${resolved}`, { cause: error })
      }
      missingSegments.push(path.basename(current))
      current = parent
    }
  }
}

export async function assertSafeGeckodriverOutputDirectory(requestedOutputDirectory) {
  if (typeof requestedOutputDirectory !== 'string' || requestedOutputDirectory.trim() === '') {
    throw new TypeError('geckodriver output directory must be a non-empty path')
  }
  const resolvedOutputDirectory = path.resolve(requestedOutputDirectory)
  try {
    const stats = await lstat(resolvedOutputDirectory)
    if (stats.isSymbolicLink()) {
      throw new Error(`geckodriver output directory must not be a symbolic link: ${resolvedOutputDirectory}`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  }

  const rootCandidates = [os.tmpdir(), process.cwd(), os.homedir(), repositoryRoot]
  if (process.env.RUNNER_TEMP) {
    rootCandidates.push(process.env.RUNNER_TEMP)
  }
  const [
    canonicalOutputDirectory,
    canonicalTemporaryRoot,
    canonicalCwd,
    canonicalHome,
    canonicalRepository,
    canonicalRunnerRoot,
  ] = await Promise.all([
    canonicalizePotentialPath(resolvedOutputDirectory),
    ...rootCandidates.map((candidate) => canonicalizePotentialPath(candidate)),
  ])
  const filesystemRoot = path.parse(canonicalOutputDirectory).root
  if ([filesystemRoot, canonicalCwd, canonicalHome, canonicalRepository].includes(canonicalOutputDirectory)) {
    throw new Error(`Refusing to recursively remove protected path: ${canonicalOutputDirectory}`)
  }
  if (isPathWithin(canonicalOutputDirectory, canonicalRepository)) {
    throw new Error(`Refusing to recursively remove source tree path: ${canonicalOutputDirectory}`)
  }

  const isUsableTemporaryRoot = (candidate) =>
    candidate !== path.parse(candidate).root &&
    ![canonicalCwd, canonicalHome, canonicalRepository].includes(candidate) &&
    !isPathWithin(candidate, canonicalRepository)
  const isTemporaryOutput =
    isUsableTemporaryRoot(canonicalTemporaryRoot) &&
    canonicalOutputDirectory !== canonicalTemporaryRoot &&
    isPathWithin(canonicalOutputDirectory, canonicalTemporaryRoot)
  const isRunnerTemporaryOutput =
    canonicalRunnerRoot !== undefined &&
    isUsableTemporaryRoot(canonicalRunnerRoot) &&
    canonicalOutputDirectory !== canonicalRunnerRoot &&
    isPathWithin(canonicalOutputDirectory, canonicalRunnerRoot)
  if (!isTemporaryOutput && !isRunnerTemporaryOutput) {
    throw new Error(`geckodriver output directory is outside allowed temporary roots: ${canonicalOutputDirectory}`)
  }
  return canonicalOutputDirectory
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

async function readBoundedArchiveBody(response, maxBytes, signal) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError('geckodriver archive byte limit must be a positive safe integer')
  }
  throwIfAborted(signal, 'geckodriver download')
  const declaredLengthText = response.headers.get('content-length')
  let declaredLength = null
  if (declaredLengthText !== null) {
    declaredLength = /^\d+$/u.test(declaredLengthText) ? Number(declaredLengthText) : Number.NaN
    if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0) {
      cancelBody(response)
      throw new Error(`geckodriver archive has invalid Content-Length: ${declaredLengthText}`)
    }
    if (declaredLength > maxBytes) {
      cancelBody(response)
      throw new Error(`geckodriver archive Content-Length exceeds ${maxBytes} bytes: ${declaredLengthText}`)
    }
  }
  if (!response.body) {
    throw new Error('geckodriver download response body is unavailable')
  }

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  let complete = false
  try {
    while (true) {
      let record
      try {
        record = await awaitWithSignal(() => reader.read(), signal, 'geckodriver download')
      } catch (error) {
        if (signal.aborted) {
          throw error
        }
        throw new Error('geckodriver archive body stream failed', { cause: error })
      }
      if (record.done) {
        complete = true
        break
      }
      const chunk = record.value
      if (!(chunk instanceof Uint8Array)) {
        throw new Error('geckodriver archive body stream returned a non-byte chunk')
      }
      total += chunk.byteLength
      if (total > maxBytes) {
        throw new Error(`geckodriver archive exceeds ${maxBytes} bytes: received at least ${total}`)
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
  throwIfAborted(signal, 'geckodriver download')
  if (total === 0) {
    throw new Error('geckodriver archive body is empty')
  }
  if (declaredLength !== null && total !== declaredLength) {
    throw new Error(`geckodriver archive Content-Length mismatch: declared ${declaredLength}, received ${total}`)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function sha256WithSignal(bytes, signal) {
  const hash = createHash('sha256')
  for (let offset = 0; offset < bytes.byteLength; offset += HASH_CHUNK_BYTES) {
    throwIfAborted(signal, 'geckodriver archive hash')
    hash.update(bytes.subarray(offset, Math.min(offset + HASH_CHUNK_BYTES, bytes.byteLength)))
    await yieldToEventLoop()
  }
  throwIfAborted(signal, 'geckodriver archive hash')
  return hash.digest('hex')
}

export async function fetchGeckodriverArchive(options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GECKODRIVER_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? MAX_GECKODRIVER_ARCHIVE_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_GECKODRIVER_ARCHIVE_BYTES) {
    throw new RangeError(`geckodriver archive byte limit must be between 1 and ${MAX_GECKODRIVER_ARCHIVE_BYTES}`)
  }
  const deadline = createDeadlineSignal(options.signal, timeoutMs, 'geckodriver download')
  try {
    const response = await awaitWithSignal(
      () =>
        (options.fetchImpl ?? globalThis.fetch)(browserSupport.geckodriver.linuxArchiveUrl, {
          redirect: 'follow',
          signal: deadline.signal,
        }),
      deadline.signal,
      'geckodriver download',
    )
    if (!response.ok) {
      cancelBody(response)
      throw new Error(`geckodriver download failed with HTTP ${response.status}`)
    }
    const archive = await readBoundedArchiveBody(response, maxBytes, deadline.signal)
    const digest = await sha256WithSignal(archive, deadline.signal)
    if (digest !== browserSupport.geckodriver.linuxArchiveSha256) {
      throw new Error(
        `geckodriver archive SHA-256 mismatch: expected ${browserSupport.geckodriver.linuxArchiveSha256}, received ${digest}`,
      )
    }
    return archive
  } finally {
    deadline.cleanup()
  }
}

export async function installGeckodriver(options = {}) {
  const requestedOutputDirectory =
    options.outputDirectory ?? path.join(os.tmpdir(), `geckodriver-${browserSupport.geckodriver.version}`)
  const initialOutputDirectory = await assertSafeGeckodriverOutputDirectory(requestedOutputDirectory)
  const archive = await fetchGeckodriverArchive(options)
  const outputDirectory = await assertSafeGeckodriverOutputDirectory(requestedOutputDirectory)
  if (outputDirectory !== initialOutputDirectory) {
    throw new Error(`geckodriver output directory changed while downloading: ${requestedOutputDirectory}`)
  }
  const archivePath = path.join(outputDirectory, 'geckodriver.tar.gz')
  const executablePath = path.join(outputDirectory, 'geckodriver')

  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(archivePath, archive, { mode: 0o600 })
  try {
    const runExecFile = options.execFileImpl ?? execFileAsync
    await runExecFile('tar', ['-xzf', archivePath, '-C', outputDirectory])
    await chmod(executablePath, 0o755)
    const { stdout } = await runExecFile(executablePath, ['--version'])
    const actualVersion = parseGeckodriverVersion(stdout)
    if (actualVersion !== browserSupport.geckodriver.version) {
      throw new Error(`Expected geckodriver ${browserSupport.geckodriver.version}, received ${actualVersion}`)
    }
  } finally {
    await rm(archivePath, { force: true })
  }

  const githubOutput = options.githubOutput ?? process.env.GITHUB_OUTPUT
  if (githubOutput) {
    await appendFile(githubOutput, `path=${executablePath}\nversion=${browserSupport.geckodriver.version}\n`)
  }
  return { executablePath, outputDirectory, version: browserSupport.geckodriver.version }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  const result = await installGeckodriver({
    outputDirectory: process.argv[2],
    timeoutMs: DEFAULT_GECKODRIVER_TIMEOUT_MS,
  })
  process.stdout.write(`${result.executablePath}\n`)
}
