const ALLOWED_ORIGINS = new Set(['https://hentaiverse.org', 'https://alt.hentaiverse.org'])
const CORS_ALLOW_METHODS = 'GET, HEAD, OPTIONS'
const CORS_ALLOW_HEADERS = 'Authorization'
const CACHE_CONTROL = 'no-store'
const INTERNAL_ERROR_MESSAGE = 'Internal Server Error'
const QUOTA_EXCEEDED_MESSAGE = 'Monthly model download quota exceeded'
const SERVICE_UNAVAILABLE_MESSAGE = 'Service Unavailable'

function appendVaryOrigin(headers: Headers): void {
  const tokens = (headers.get('vary') ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  if (!tokens.some((token) => token.toLowerCase() === 'origin')) {
    tokens.push('Origin')
  }
  headers.set('vary', tokens.join(', '))
}

export function addCorsHeaders(headers: Headers, request: Request): Headers {
  const origin = request.headers.get('origin')
  if (!origin) {
    headers.set('access-control-allow-origin', '*')
  } else if (ALLOWED_ORIGINS.has(origin)) {
    headers.set('access-control-allow-origin', origin)
  }
  appendVaryOrigin(headers)
  return headers
}

function addPublicCorsHeaders(headers: Headers): Headers {
  headers.set('access-control-allow-origin', '*')
  return headers
}

export function textResponse(
  request: Request,
  body: string,
  status: number,
  initialHeaders: HeadersInit = {},
): Response {
  const responseHeaders = addCorsHeaders(new Headers(initialHeaders), request)
  responseHeaders.set('content-type', 'text/plain; charset=utf-8')
  responseHeaders.set('cache-control', CACHE_CONTROL)
  responseHeaders.set('x-content-type-options', 'nosniff')
  return new Response(body, { status, headers: responseHeaders })
}

export function internalErrorResponse(request: Request): Response {
  return textResponse(request, INTERNAL_ERROR_MESSAGE, 500)
}

export function quotaExceededResponse(request: Request, retryAfterSeconds: number): Response {
  return textResponse(request, QUOTA_EXCEEDED_MESSAGE, 429, {
    'access-control-expose-headers': 'Retry-After',
    'retry-after': String(retryAfterSeconds),
  })
}

export function serviceUnavailableResponse(request: Request, retryAfterSeconds: number): Response {
  return textResponse(request, SERVICE_UNAVAILABLE_MESSAGE, 503, {
    'access-control-expose-headers': 'Retry-After',
    'retry-after': String(retryAfterSeconds),
  })
}

export function modelQuotaStatusResponse(request: Request, status: unknown): Response {
  const headers = addCorsHeaders(
    new Headers({
      'cache-control': CACHE_CONTROL,
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    }),
    request,
  )
  return Response.json(status, { headers })
}

export function preflightResponse(request: Request, isPublic: boolean): Response {
  const headers = new Headers({
    'access-control-allow-methods': CORS_ALLOW_METHODS,
    'access-control-allow-headers': CORS_ALLOW_HEADERS,
    'cache-control': CACHE_CONTROL,
  })
  if (isPublic) {
    addPublicCorsHeaders(headers)
  } else {
    addCorsHeaders(headers, request)
  }
  return new Response(null, { status: 204, headers })
}

function setObjectEtag(headers: Headers, object: R2Object): void {
  if (object.httpEtag) {
    headers.set('etag', object.httpEtag)
  }
}

function createModelHeaders(request: Request, object: R2Object, filename: string): Headers {
  const headers = addCorsHeaders(
    new Headers({
      'content-type': 'application/octet-stream',
      'content-disposition': `inline; filename="${filename}"`,
      'cache-control': CACHE_CONTROL,
      'x-content-type-options': 'nosniff',
    }),
    request,
  )
  headers.set('content-length', String(object.size))
  setObjectEtag(headers, object)
  return headers
}

function objectResponseBody(request: Request, object: R2Object | R2ObjectBody): ReadableStream | null {
  if (request.method === 'HEAD') {
    return null
  }
  if (!('body' in object)) {
    throw new Error('R2 GET response is missing a body')
  }
  return object.body
}

export function modelObjectResponse(request: Request, object: R2Object | R2ObjectBody, filename: string): Response {
  const headers = createModelHeaders(request, object, filename)
  return new Response(objectResponseBody(request, object), { status: 200, headers })
}

export function runtimeObjectResponse(request: Request, object: R2Object | R2ObjectBody): Response {
  const headers = addPublicCorsHeaders(new Headers())
  headers.set('content-type', 'application/wasm')
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('content-length', String(object.size))
  setObjectEtag(headers, object)
  return new Response(objectResponseBody(request, object), { status: 200, headers })
}
