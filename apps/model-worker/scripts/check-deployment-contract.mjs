#!/usr/bin/env node
import { resolve } from 'node:path'
import { clearTimeout as cancelTimeout, setTimeout as scheduleTimeout } from 'node:timers'
import { setTimeout as sleepFor } from 'node:timers/promises'
import { fileURLToPath, URL } from 'node:url'

const ALLOWED_ORIGINS = Object.freeze(['https://hentaiverse.org', 'https://alt.hentaiverse.org'])
const EXPECTED_METHODS = Object.freeze(['get', 'head', 'options'])
const EXPECTED_HEADERS = Object.freeze(['authorization'])
const DEFAULT_ATTEMPTS = 5
const DEFAULT_RETRY_DELAY_MS = 7_500
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const PROBE_QUERY_NAME = 'deployment_check'
const RUNTIME_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const RUNTIME_PROBE_ORIGIN = 'https://deployment-check.invalid'

function parseTokenSet(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  )
}

function formatTokenSet(tokens) {
  return [...tokens].sort().join(', ') || '<missing>'
}

function assertExactTokenSet(response, headerName, expectedTokens, context) {
  const actual = parseTokenSet(response.headers.get(headerName))
  const expected = new Set(expectedTokens)
  const matches = actual.size === expected.size && [...expected].every((token) => actual.has(token))
  if (!matches) {
    throw new Error(
      `${context}: ${headerName} mismatch; expected=[${formatTokenSet(expected)}] actual=[${formatTokenSet(actual)}]`,
    )
  }
}

function assertHeaderEquals(response, headerName, expected, context) {
  const actual = response.headers.get(headerName)
  if (actual !== expected) {
    throw new Error(`${context}: ${headerName} mismatch; expected=${expected} actual=${actual ?? '<missing>'}`)
  }
}

function assertHeaderEqualsIgnoreCase(response, headerName, expected, context) {
  const actual = response.headers.get(headerName)
  if (actual?.trim().toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${context}: ${headerName} mismatch; expected=${expected} actual=${actual ?? '<missing>'}`)
  }
}

function assertHeaderPresent(response, headerName, context) {
  const actual = response.headers.get(headerName)
  if (!actual?.trim()) {
    throw new Error(`${context}: ${headerName} must be present`)
  }
}

function assertVaryOrigin(response, context) {
  const vary = parseTokenSet(response.headers.get('vary'))
  if (!vary.has('origin')) {
    throw new Error(`${context}: Vary must include Origin; actual=[${formatTokenSet(vary)}]`)
  }
}

function assertStatus(response, expected, context) {
  if (response.status !== expected) {
    throw new Error(`${context}: status mismatch; expected=${expected} actual=${response.status}`)
  }
}

function normalizeInvalidKeyMode(value) {
  const mode = String(value ?? '')
    .trim()
    .toLowerCase()
  if (mode !== 'decoy' && mode !== 'error') {
    throw new Error('invalidKeyMode must be one of: decoy, error')
  }
  return mode
}

function validatePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return value
}

function validateNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

function validateOrigins(origins) {
  if (!Array.isArray(origins) || origins.length === 0) {
    throw new Error('origins must be a non-empty array')
  }
  for (const origin of origins) {
    let url
    try {
      url = new URL(origin)
    } catch (error) {
      throw new Error(`Invalid Origin: ${origin}`, { cause: error })
    }
    if (url.protocol !== 'https:' || url.origin !== origin || url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`Invalid Origin: ${origin}`)
    }
  }
  return origins
}

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 31 || codeUnit === 127) {
      return true
    }
  }
  return false
}

function createProbeUrl(modelUrl, probeId) {
  let url
  try {
    url = new URL(modelUrl)
  } catch (error) {
    throw new Error(`Invalid modelUrl: ${modelUrl}`, { cause: error })
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('modelUrl must be an HTTPS URL without credentials or fragment')
  }
  const normalizedProbeId = String(probeId ?? '').trim()
  if (!normalizedProbeId || normalizedProbeId.length > 128 || hasControlCharacters(normalizedProbeId)) {
    throw new Error('probeId must be 1-128 characters without control characters')
  }
  url.searchParams.set(PROBE_QUERY_NAME, normalizedProbeId)
  return url.toString()
}

function createOptionsRequest(origin) {
  return {
    method: 'OPTIONS',
    redirect: 'error',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization',
    },
  }
}

function createHeadRequest(origin) {
  return {
    method: 'HEAD',
    redirect: 'error',
    headers: {
      Origin: origin,
      'Accept-Encoding': 'identity',
    },
  }
}

async function fetchForContract(fetchImpl, url, init, context, requestTimeoutMs) {
  const controller = new globalThis.AbortController()
  const timeoutError = new Error(`${context}: network request timed out after ${requestTimeoutMs}ms`)
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = scheduleTimeout(() => {
      reject(timeoutError)
      controller.abort(timeoutError)
    }, requestTimeoutMs)
  })

  try {
    return await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), timeout])
  } catch (error) {
    if (error === timeoutError) {
      throw timeoutError
    }
    throw new Error(`${context}: network request failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  } finally {
    cancelTimeout(timeoutId)
  }
}

function assertOptionsContract(response, origin, assetName) {
  const context = `OPTIONS origin=${origin} asset=${assetName}`
  assertStatus(response, 204, context)
  assertHeaderEquals(response, 'access-control-allow-origin', origin, context)
  assertExactTokenSet(response, 'access-control-allow-methods', EXPECTED_METHODS, context)
  assertExactTokenSet(response, 'access-control-allow-headers', EXPECTED_HEADERS, context)
  assertHeaderEqualsIgnoreCase(response, 'cache-control', 'no-store', context)
  assertVaryOrigin(response, context)
}

function assertHeadContract(response, origin, invalidKeyMode, assetName) {
  const context = `HEAD origin=${origin} asset=${assetName}`
  assertStatus(response, invalidKeyMode === 'decoy' ? 200 : 403, context)
  assertHeaderEquals(response, 'access-control-allow-origin', origin, context)
  assertHeaderEqualsIgnoreCase(response, 'cache-control', 'no-store', context)
  assertVaryOrigin(response, context)
}

function assertRuntimeHeadContract(response, expectedByteLength) {
  const context = 'HEAD asset=runtime-wasm'
  assertStatus(response, 200, context)
  assertHeaderEquals(response, 'access-control-allow-origin', '*', context)
  assertHeaderEqualsIgnoreCase(response, 'content-type', 'application/wasm', context)
  assertHeaderEqualsIgnoreCase(response, 'cache-control', RUNTIME_CACHE_CONTROL, context)
  assertHeaderEqualsIgnoreCase(response, 'x-content-type-options', 'nosniff', context)
  assertHeaderEquals(response, 'content-length', String(expectedByteLength), context)
  assertHeaderPresent(response, 'etag', context)
}

async function checkModelContract({ fetchImpl, modelUrl, invalidKeyMode, origins, requestTimeoutMs, assetName }) {
  for (const origin of origins) {
    const optionsContext = `OPTIONS origin=${origin}`
    const optionsResponse = await fetchForContract(
      fetchImpl,
      modelUrl,
      createOptionsRequest(origin),
      optionsContext,
      requestTimeoutMs,
    )
    assertOptionsContract(optionsResponse, origin, assetName)

    const headContext = `HEAD origin=${origin}`
    const headResponse = await fetchForContract(
      fetchImpl,
      modelUrl,
      createHeadRequest(origin),
      headContext,
      requestTimeoutMs,
    )
    assertHeadContract(headResponse, origin, invalidKeyMode, assetName)
  }
}

async function checkContractRound({
  fetchImpl,
  modelUrl,
  ortModelUrl,
  runtimeWasmUrl,
  runtimeWasmByteLength,
  invalidKeyMode,
  origins,
  requestTimeoutMs,
}) {
  await checkModelContract({
    fetchImpl,
    modelUrl,
    invalidKeyMode,
    origins,
    requestTimeoutMs,
    assetName: 'legacy-model',
  })
  if (!ortModelUrl || !runtimeWasmUrl || !runtimeWasmByteLength) {
    return
  }
  await checkModelContract({
    fetchImpl,
    modelUrl: ortModelUrl,
    invalidKeyMode,
    origins,
    requestTimeoutMs,
    assetName: 'ort-model',
  })
  const runtimeResponse = await fetchForContract(
    fetchImpl,
    runtimeWasmUrl,
    createHeadRequest(RUNTIME_PROBE_ORIGIN),
    'HEAD asset=runtime-wasm',
    requestTimeoutMs,
  )
  assertRuntimeHeadContract(runtimeResponse, runtimeWasmByteLength)
}

async function defaultSleep(delayMs) {
  await sleepFor(delayMs)
}

async function checkDeploymentContract({
  modelUrl,
  ortModelUrl,
  runtimeWasmUrl,
  runtimeWasmByteLength,
  invalidKeyMode,
  origins = ALLOWED_ORIGINS,
  probeId,
  fetchImpl = globalThis.fetch,
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  sleep = defaultSleep,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetchImpl must be a function')
  }
  if (typeof sleep !== 'function') {
    throw new Error('sleep must be a function')
  }
  const normalizedMode = normalizeInvalidKeyMode(invalidKeyMode)
  const normalizedOrigins = validateOrigins(origins)
  const normalizedAttempts = validatePositiveInteger(attempts, 'attempts')
  const normalizedRetryDelayMs = validateNonNegativeInteger(retryDelayMs, 'retryDelayMs')
  const normalizedRequestTimeoutMs = validatePositiveInteger(requestTimeoutMs, 'requestTimeoutMs')
  const probeUrl = createProbeUrl(modelUrl, probeId)
  const extendedValues = [ortModelUrl, runtimeWasmUrl, runtimeWasmByteLength]
  const hasExtendedContract = extendedValues.some((value) => value !== undefined)
  if (hasExtendedContract && extendedValues.some((value) => value === undefined)) {
    throw new Error('ortModelUrl, runtimeWasmUrl, and runtimeWasmByteLength must be provided together')
  }
  const ortProbeUrl = hasExtendedContract ? createProbeUrl(ortModelUrl, probeId) : undefined
  const runtimeProbeUrl = hasExtendedContract ? createProbeUrl(runtimeWasmUrl, probeId) : undefined
  const normalizedRuntimeWasmByteLength = hasExtendedContract
    ? validatePositiveInteger(runtimeWasmByteLength, 'runtimeWasmByteLength')
    : undefined
  let lastError

  for (let attempt = 1; attempt <= normalizedAttempts; attempt += 1) {
    try {
      await checkContractRound({
        fetchImpl,
        modelUrl: probeUrl,
        ortModelUrl: ortProbeUrl,
        runtimeWasmUrl: runtimeProbeUrl,
        runtimeWasmByteLength: normalizedRuntimeWasmByteLength,
        invalidKeyMode: normalizedMode,
        origins: normalizedOrigins,
        requestTimeoutMs: normalizedRequestTimeoutMs,
      })
      return {
        attempt,
        attempts: normalizedAttempts,
        invalidKeyMode: normalizedMode,
        modelUrl: probeUrl,
        origins: [...normalizedOrigins],
        assets: hasExtendedContract ? 3 : 1,
      }
    } catch (error) {
      lastError = error
      if (attempt < normalizedAttempts) {
        await sleep(normalizedRetryDelayMs)
      }
    }
  }

  throw new Error(
    `Model Worker deployment contract failed after ${normalizedAttempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { cause: lastError },
  )
}

function requireEnv(env, name) {
  const value = env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function parseIntegerEnv(env, name, defaultValue, { positive }) {
  const raw = env[name]?.trim()
  if (!raw) {
    return defaultValue
  }
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${name} must be an integer`)
  }
  const value = Number(raw)
  return positive ? validatePositiveInteger(value, name) : validateNonNegativeInteger(value, name)
}

async function runCli({
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const result = await checkDeploymentContract({
      modelUrl: requireEnv(env, 'MODEL_WORKER_URL'),
      ortModelUrl: requireEnv(env, 'MODEL_WORKER_ORT_URL'),
      runtimeWasmUrl: requireEnv(env, 'MODEL_WORKER_RUNTIME_WASM_URL'),
      runtimeWasmByteLength: parseIntegerEnv(env, 'MODEL_WORKER_RUNTIME_WASM_BYTE_LENGTH', undefined, {
        positive: true,
      }),
      invalidKeyMode: requireEnv(env, 'MODEL_WORKER_INVALID_KEY_MODE'),
      probeId: requireEnv(env, 'MODEL_WORKER_PROBE_ID'),
      fetchImpl,
      attempts: parseIntegerEnv(env, 'MODEL_WORKER_CHECK_ATTEMPTS', DEFAULT_ATTEMPTS, { positive: true }),
      retryDelayMs: parseIntegerEnv(env, 'MODEL_WORKER_CHECK_RETRY_DELAY_MS', DEFAULT_RETRY_DELAY_MS, {
        positive: false,
      }),
      requestTimeoutMs: parseIntegerEnv(env, 'MODEL_WORKER_CHECK_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS, {
        positive: true,
      }),
      sleep,
    })
    stdout.write(
      `Model Worker deployment contract verified: attempt=${result.attempt}/${result.attempts} mode=${result.invalidKeyMode} origins=${result.origins.length} assets=${result.assets}\n`,
    )
    return 0
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

function isDirectRun() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isDirectRun()) {
  process.exitCode = await runCli()
}

export {
  ALLOWED_ORIGINS,
  DEFAULT_ATTEMPTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RETRY_DELAY_MS,
  checkDeploymentContract,
  createProbeUrl,
  parseTokenSet,
  runCli,
}
