import { readWorkerConfig } from './env'
import { getCanonicalRequestAccessToken, selectModelAccess } from './model-access'
import { consumeModelDownloadQuota } from './model-download-quota'
import {
  modelObjectResponse,
  internalErrorResponse,
  preflightResponse,
  quotaExceededResponse,
  runtimeObjectResponse,
  textResponse,
} from './model-response'
import type { Env, WorkerConfig } from './worker-types'

const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'
const LEGACY_MODEL_FILENAME = 'yolo26n-640.onnx'
const ORT_MODEL_FILENAME = 'yolo26n-640.ort'

type ModelRoute = Readonly<{
  filename: string
  realObjectKey: string
}>

function filenameForPath(pathname: string, fallback: string): string {
  return pathname.slice(pathname.lastIndexOf('/') + 1) || fallback
}

async function readObjectForRequest(request: Request, env: Env, objectKey: string): Promise<R2Object | R2ObjectBody | null> {
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
  if (access === 'forbidden') {
    return textResponse(request, 'Forbidden', 403)
  }
  const objectKey = access === 'real' ? route.realObjectKey : config.decoyModelObjectKey
  const object = await readObjectForRequest(request, env, objectKey)
  if (!object) {
    return internalErrorResponse(request)
  }
  const response = modelObjectResponse(request, object, route.filename)
  if (access !== 'real' || request.method !== 'GET') {
    return response
  }

  const canonicalToken = getCanonicalRequestAccessToken(request)
  if (!canonicalToken) {
    await cancelResponseBody(response)
    throw new Error('Authorized model request is missing a canonical token')
  }
  try {
    const quota = await consumeModelDownloadQuota(env.MODEL_DOWNLOAD_QUOTAS, canonicalToken)
    if (quota.allowed) {
      return response
    }
    await cancelResponseBody(response)
    return quotaExceededResponse(request, quota.retryAfterSeconds)
  } catch (error) {
    await cancelResponseBody(response)
    throw error
  }
}

async function serveRuntime(request: Request, env: Env, config: WorkerConfig): Promise<Response> {
  const object = await readObjectForRequest(request, env, config.runtimeWasmObjectKey)
  if (!object) {
    return internalErrorResponse(request)
  }
  return runtimeObjectResponse(request, object)
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  try {
    const config = readWorkerConfig(env)
    const pathname = new URL(request.url).pathname
    const isLegacyModel = pathname === config.publicModelPath
    const isOrtModel = pathname === config.publicOrtModelPath
    const isRuntime = pathname === config.publicRuntimeWasmPath

    if (!isLegacyModel && !isOrtModel && !isRuntime) {
      return textResponse(request, 'Not Found', 404)
    }
    if (request.method === 'OPTIONS') {
      return preflightResponse(request, isRuntime)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse(request, 'Method Not Allowed', 405, { allow: ALLOWED_METHODS })
    }
    if (isRuntime) {
      return await serveRuntime(request, env, config)
    }

    const route: ModelRoute = isOrtModel
      ? {
          filename: filenameForPath(config.publicOrtModelPath, ORT_MODEL_FILENAME),
          realObjectKey: config.realOrtModelObjectKey,
        }
      : { filename: LEGACY_MODEL_FILENAME, realObjectKey: config.realModelObjectKey }
    return await serveModel(request, env, config, route)
  } catch {
    return textResponse(request, 'Internal Server Error', 500)
  }
}
