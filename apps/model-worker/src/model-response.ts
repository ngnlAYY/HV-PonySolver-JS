import { MODEL_FILENAME, type ModelAccessDecision } from '@hv-pony-solver/shared'
import type { NormalizedEnv } from './worker-types'

const CACHE_CONTROL = 'no-store'
const MODEL_CONTENT_TYPE = 'application/octet-stream'
const INTERNAL_ERROR_MESSAGE = 'Internal Server Error'
const CORS_ALLOW_ORIGIN = '*'
const CORS_ALLOW_METHODS = 'GET, HEAD, OPTIONS'
const CORS_ALLOW_HEADERS = 'Authorization'
const ALLOWED_ORIGINS = new Set<string>(['https://hentaiverse.org', 'https://alt.hentaiverse.org'])

function addSecurityHeaders(headers: Headers): Headers {
  headers.set('x-content-type-options', 'nosniff')
  return headers
}

export function addCorsHeaders(headers: Headers, request: Request): Headers {
  const origin = request.headers.get('origin')
  appendVaryOrigin(headers)

  if (origin === null) {
    headers.set('access-control-allow-origin', CORS_ALLOW_ORIGIN)
    return headers
  }

  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set('access-control-allow-origin', origin)
  }

  return headers
}

function appendVaryOrigin(headers: Headers): void {
  const vary = headers.get('vary')
  if (vary === null) {
    headers.set('vary', 'Origin')
    return
  }
  const values = vary.split(',').map((value) => value.trim().toLowerCase())
  if (!values.includes('origin')) {
    headers.set('vary', `${vary}, Origin`)
  }
}

export function textResponse(request: Request, body: string, status: number, headers: HeadersInit = {}): Response {
  const responseHeaders = addSecurityHeaders(new Headers(headers))
  if (!responseHeaders.has('cache-control')) {
    responseHeaders.set('cache-control', CACHE_CONTROL)
  }

  return new Response(body, {
    status,
    headers: addCorsHeaders(responseHeaders, request),
  })
}

export function preflightResponse(request: Request): Response {
  const headers = addSecurityHeaders(new Headers({
    'access-control-allow-headers': CORS_ALLOW_HEADERS,
    'access-control-allow-methods': CORS_ALLOW_METHODS,
    'cache-control': CACHE_CONTROL,
  }))

  return new Response(null, {
    status: 204,
    headers: addCorsHeaders(headers, request),
  })
}

function createModelHeaders(object: R2ObjectBody, request: Request): Headers {
  const headers = new Headers({
    'content-type': MODEL_CONTENT_TYPE,
    'content-disposition': `inline; filename="${MODEL_FILENAME}"`,
    'cache-control': CACHE_CONTROL,
  })

  if (object.httpEtag) {
    headers.set('etag', object.httpEtag)
  }

  return addCorsHeaders(addSecurityHeaders(headers), request)
}

export async function createModelResponse(
  request: Request,
  env: NormalizedEnv,
  decision: ModelAccessDecision,
): Promise<Response> {
  if (decision === 'forbidden') {
    return textResponse(request, 'Forbidden', 403)
  }

  const objectKey = decision === 'real' ? env.realModelObjectKey : env.decoyModelObjectKey
  const object = await env.modelBucket.get(objectKey)
  if (object === null) {
    return textResponse(request, INTERNAL_ERROR_MESSAGE, 500, { 'content-type': 'text/plain;charset=UTF-8' })
  }

  return new Response(request.method === 'HEAD' ? null : object.body, {
    status: 200,
    headers: createModelHeaders(object, request),
  })
}
