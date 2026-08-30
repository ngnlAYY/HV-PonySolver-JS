import { readWorkerConfig } from './env'
import { hasExpectedR2ObjectIntegrity, type AssetIntegrity } from './asset-integrity'
import { logWorkerError, logWorkerWarning, workerErrorName, type WorkerLogRoute } from './logger'
import { selectModelAccess } from './model-access'
import { withModelWorkerDependencyTimeout } from './request-timeout'
import {
  confirmModelDownloadQuota,
  readModelDownloadQuota,
  reserveModelDownloadQuota,
  type ModelDownloadQuotaStatus,
} from './model-download-quota'
import {
  attachModelDownloadReceipt,
  modelObjectResponse,
  modelQuotaStatusResponse,
  internalErrorResponse,
  preflightResponse,
  quotaExceededResponse,
  runtimeObjectResponse,
  serviceUnavailableResponse,
  textResponse,
} from './model-response'
import type { Env, WorkerConfig } from './worker-types'

import {
  MODEL_FILENAME,
  MODEL_DOWNLOAD_RECEIPT_HEADER,
  MODEL_INTEGRITY,
  ORT_MODEL_INTEGRITY,
  ORT_MODEL_FILENAME,
  ORT_RUNTIME_WASM_INTEGRITY,
  normalizeModelDownloadReceiptId,
} from '@hv-pony-solver/shared'

const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'
const QUOTA_ALLOWED_METHODS = 'GET, POST, OPTIONS'
const MODEL_ALLOWED_HEADERS = 'Authorization'
const QUOTA_ALLOWED_HEADERS = `Authorization, ${MODEL_DOWNLOAD_RECEIPT_HEADER}`
const QUOTA_FAILURE_RETRY_AFTER_SECONDS = 5

type ModelRoute = Readonly<{
  filename: string
  integrity: AssetIntegrity
  logRoute: WorkerLogRoute
  realObjectKey: string
}>

type PublicQuotaStatus = Readonly<{
  enabled: boolean
  limit: number
  used: number
  remaining: number | null
  retryAfterSeconds: number | null
}>

function filenameForPath(pathname: string, fallback: string): string {
  return pathname.slice(pathname.lastIndexOf('/') + 1) || fallback
}

async function readObjectForRequest(
  request: Request,
  env: Env,
  objectKey: string,
): Promise<R2Object | R2ObjectBody | null> {
  return withModelWorkerDependencyTimeout(
    request.method === 'HEAD' ? env.MODEL_BUCKET.head(objectKey) : env.MODEL_BUCKET.get(objectKey),
    'R2',
  )
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Cancellation is best-effort cleanup and must not replace the primary response error.
  }
}

async function cancelObjectBody(object: R2Object | R2ObjectBody): Promise<void> {
  if (!('body' in object)) return
  try {
    await object.body.cancel()
  } catch {
    // Integrity failure remains authoritative if stream cleanup also fails.
  }
}

async function serveModel(request: Request, env: Env, config: WorkerConfig, route: ModelRoute): Promise<Response> {
  const access = await selectModelAccess(request, env.MODEL_KEYS, config.invalidKeyMode)
  if (access.decision === 'forbidden') {
    return textResponse(request, 'Forbidden', 403)
  }
  const objectKey = access.decision === 'real' ? route.realObjectKey : config.decoyModelObjectKey
  const object = await readObjectForRequest(request, env, objectKey)
  if (!object) {
    return internalErrorResponse(request)
  }
  if (access.decision === 'real' && !hasExpectedR2ObjectIntegrity(object, route.integrity)) {
    await cancelObjectBody(object)
    return internalErrorResponse(request)
  }
  const response = modelObjectResponse(request, object, route.filename)
  if (access.decision !== 'real' || request.method !== 'GET' || !config.downloadQuotaEnabled) {
    return response
  }

  if (!access.canonicalToken) {
    await cancelResponseBody(response)
    throw new Error('Authorized model request is missing a canonical token')
  }
  try {
    const quota = await reserveModelDownloadQuota(env.MODEL_DOWNLOAD_QUOTAS, access.canonicalToken)
    if (quota.allowed) {
      return attachModelDownloadReceipt(response, quota.receiptId)
    }
    await cancelResponseBody(response)
    return quota.reason === 'quota-exhausted'
      ? quotaExceededResponse(request, quota.retryAfterSeconds)
      : serviceUnavailableResponse(request, quota.retryAfterSeconds)
  } catch (error) {
    await cancelResponseBody(response)
    // Log only non-sensitive classification fields; the underlying error message may embed quota identities.
    logWorkerWarning({
      route: route.logRoute,
      errorKind: 'quota-storage-unavailable',
      errorName: workerErrorName(error),
    })
    return serviceUnavailableResponse(request, QUOTA_FAILURE_RETRY_AFTER_SECONDS)
  }
}

async function serveRuntime(request: Request, env: Env, config: WorkerConfig): Promise<Response> {
  const object = await readObjectForRequest(request, env, config.runtimeWasmObjectKey)
  if (!object) {
    return internalErrorResponse(request)
  }
  if (!hasExpectedR2ObjectIntegrity(object, ORT_RUNTIME_WASM_INTEGRITY)) {
    await cancelObjectBody(object)
    return internalErrorResponse(request)
  }
  return runtimeObjectResponse(request, object)
}

async function serveQuota(request: Request, env: Env, config: WorkerConfig): Promise<Response> {
  const access = await selectModelAccess(request, env.MODEL_KEYS, config.invalidKeyMode)
  if (access.decision !== 'real' || !access.canonicalToken) {
    return textResponse(request, 'Forbidden', 403)
  }
  let receiptId: string | null = null
  if (request.method === 'POST') {
    receiptId = normalizeModelDownloadReceiptId(request.headers.get(MODEL_DOWNLOAD_RECEIPT_HEADER))
    if (receiptId === null) {
      return textResponse(request, 'Invalid model download receipt', 400)
    }
  }
  if (!config.downloadQuotaEnabled) {
    if (request.method === 'POST') {
      return textResponse(request, 'Model download quota is disabled', 409)
    }
    const status: PublicQuotaStatus = {
      enabled: false,
      limit: 0,
      used: 0,
      remaining: null,
      retryAfterSeconds: null,
    }
    return modelQuotaStatusResponse(request, status)
  }
  try {
    if (receiptId !== null) {
      const confirmation = await confirmModelDownloadQuota(env.MODEL_DOWNLOAD_QUOTAS, access.canonicalToken, receiptId)
      if (!confirmation.confirmed) {
        return textResponse(request, 'Model download receipt expired', 409)
      }
      return modelQuotaStatusResponse(request, confirmation)
    }
    const quota: ModelDownloadQuotaStatus = await readModelDownloadQuota(
      env.MODEL_DOWNLOAD_QUOTAS,
      access.canonicalToken,
    )
    const status: PublicQuotaStatus = { enabled: true, ...quota }
    return modelQuotaStatusResponse(request, status)
  } catch (error) {
    logWorkerWarning({
      route: 'quota',
      errorKind: 'quota-storage-unavailable',
      errorName: workerErrorName(error),
    })
    return serviceUnavailableResponse(request, QUOTA_FAILURE_RETRY_AFTER_SECONDS)
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  let logRoute: WorkerLogRoute = 'request'
  try {
    const config = readWorkerConfig(env)
    const pathname = new URL(request.url).pathname
    const isLegacyModel = pathname === config.publicModelPath
    const isQuota = pathname === config.publicQuotaPath
    const isOrtModel = pathname === config.publicOrtModelPath
    const isRuntime = pathname === config.publicRuntimeWasmPath

    if (!isLegacyModel && !isQuota && !isOrtModel && !isRuntime) {
      return textResponse(request, 'Not Found', 404)
    }
    if (request.method === 'OPTIONS') {
      return preflightResponse(request, {
        allowMethods: isQuota ? QUOTA_ALLOWED_METHODS : ALLOWED_METHODS,
        ...(isRuntime ? {} : { allowHeaders: isQuota ? QUOTA_ALLOWED_HEADERS : MODEL_ALLOWED_HEADERS }),
        isPublic: isRuntime,
      })
    }
    const methodAllowed = isQuota
      ? request.method === 'GET' || request.method === 'POST'
      : request.method === 'GET' || request.method === 'HEAD'
    if (!methodAllowed) {
      if (isQuota) return textResponse(request, 'Method Not Allowed', 405, { allow: QUOTA_ALLOWED_METHODS })
      return textResponse(request, 'Method Not Allowed', 405, { allow: ALLOWED_METHODS })
    }
    if (isQuota) {
      logRoute = 'quota'
      return await serveQuota(request, env, config)
    }
    if (isRuntime) {
      logRoute = 'runtime'
      return await serveRuntime(request, env, config)
    }

    logRoute = isOrtModel ? 'ort-model' : 'legacy-model'
    const route: ModelRoute = isOrtModel
      ? {
          filename: filenameForPath(config.publicOrtModelPath, ORT_MODEL_FILENAME),
          integrity: ORT_MODEL_INTEGRITY,
          logRoute: 'ort-model',
          realObjectKey: config.realOrtModelObjectKey,
        }
      : {
          filename: filenameForPath(config.publicModelPath, MODEL_FILENAME),
          integrity: MODEL_INTEGRITY,
          logRoute: 'legacy-model',
          realObjectKey: config.realModelObjectKey,
        }
    return await serveModel(request, env, config, route)
  } catch (error) {
    logWorkerError({ route: logRoute, errorKind: 'unhandled-exception', errorName: workerErrorName(error) })
    return textResponse(request, 'Internal Server Error', 500)
  }
}
