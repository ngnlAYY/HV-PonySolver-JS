import { readWorkerConfig } from './env'
import {
  modelObjectResponse,
  internalErrorResponse,
  preflightResponse,
  runtimeObjectResponse,
  textResponse,
} from './model-response'
import type { Env, WorkerConfig } from './worker-types'

const ALLOWED_METHODS = 'GET, HEAD, OPTIONS'
const ACCESS_TOKEN_PATTERN = /^[0-9a-f]{64}$/i
const LEGACY_MODEL_FILENAME = 'yolo26n-640.onnx'
const ORT_MODEL_FILENAME = 'yolo26n-640.ort'

type ModelRoute = Readonly<{
  filename: string
  realObjectKey: string
}>

function filenameForPath(pathname: string, fallback: string): string {
  return pathname.slice(pathname.lastIndexOf('/') + 1) || fallback
}

function readBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization')
  if (!authorization) {
    return undefined
  }
  return /^Bearer\s+([^\s]+)$/i.exec(authorization.trim())?.[1]
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const token = readBearerToken(request)
  if (!token || !ACCESS_TOKEN_PATTERN.test(token)) {
    return false
  }
  const candidates = [...new Set([token, token.toLowerCase(), token.toUpperCase()])]
  for (const candidate of candidates) {
    if ((await env.MODEL_KEYS.get(candidate)) !== null) {
      return true
    }
  }
  return false
}

async function serveModel(request: Request, env: Env, config: WorkerConfig, route: ModelRoute): Promise<Response> {
  const authorized = await isAuthorized(request, env)
  if (!authorized && config.invalidKeyMode === 'error') {
    return textResponse(request, 'Forbidden', 403)
  }
  const objectKey = authorized ? route.realObjectKey : config.decoyModelObjectKey
  const object = await env.MODEL_BUCKET.get(objectKey)
  if (!object) {
    return internalErrorResponse(request)
  }
  return modelObjectResponse(request, object, route.filename)
}

async function serveRuntime(request: Request, env: Env, config: WorkerConfig): Promise<Response> {
  const object = await env.MODEL_BUCKET.get(config.runtimeWasmObjectKey)
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
      return serveRuntime(request, env, config)
    }

    const route: ModelRoute = isOrtModel
      ? {
          filename: filenameForPath(config.publicOrtModelPath, ORT_MODEL_FILENAME),
          realObjectKey: config.realOrtModelObjectKey,
        }
      : { filename: LEGACY_MODEL_FILENAME, realObjectKey: config.realModelObjectKey }
    return serveModel(request, env, config, route)
  } catch {
    return textResponse(request, 'Internal Server Error', 500)
  }
}
