import { readWorkerConfig } from './env'
import { logWorkerError, logWorkerWarning, workerErrorName, type WorkerLogRoute } from './logger'
import { selectModelAccess } from './model-access'
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

import { MODEL_DOWNLOAD_RECEIPT_HEADER } from '@hv-pony-solver/shared'

const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'
const QUOTA_ALLOWED_METHODS = 'GET, POST, OPTIONS'
const LEGACY_MODEL_FILENAME = 'yolo26n-640.onnx'
const ORT_MODEL_FILENAME = 'yolo26n-640.ort'
const QUOTA_FAILURE_RETRY_AFTER_SECONDS = 5

type ModelRoute = Readonly<{
  filename: string
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
  return request.method === 'HEAD' ? env.MODEL_BUCKET.head(objectKey) : env.MODEL_BUCKET.get(objectKey)
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Cancellation is best-effort cleanup and must not replace the primary response error.
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
  return runtimeObjectResponse(request, object)
}

async function serveQuota(request: Request, env: Env, config: WorkerConfig): Promise<Response> {
  const access = await selectModelAccess(request, env.MODEL_KEYS, config.invalidKeyMode)
  if (access.decision !== 'real' || !access.canonicalToken) {
    return textResponse(request, 'Forbidden', 403)
  }
  if (!config.downloadQuotaEnabled) {
    if (request.method === 'POST') {
      return modelQuotaStatusResponse(request, { confirmed: true, alreadyConfirmed: false })
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
    if (request.method === 'POST') {
      const receiptId = request.headers.get(MODEL_DOWNLOAD_RECEIPT_HEADER)?.trim() ?? ''
      if (!/^[0-9a-f]{32}$/i.test(receiptId)) {
        return textResponse(request, 'Invalid model download receipt', 400)
      }
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
      return preflightResponse(request, isRuntime)
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
          logRoute: 'ort-model',
          realObjectKey: config.realOrtModelObjectKey,
        }
      : { filename: LEGACY_MODEL_FILENAME, logRoute: 'legacy-model', realObjectKey: config.realModelObjectKey }
    return await serveModel(request, env, config, route)
  } catch (error) {
    logWorkerError({ route: logRoute, errorKind: 'unhandled-exception', errorName: workerErrorName(error) })
    return textResponse(request, 'Internal Server Error', 500)
  }
}
