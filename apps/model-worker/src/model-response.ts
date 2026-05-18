import { MODEL_FILENAME, type ModelAccessDecision } from '@hv-pony-solver/shared'
import type { NormalizedEnv } from './worker-types'

const CACHE_CONTROL = 'public, max-age=86400'
const MODEL_CONTENT_TYPE = 'application/octet-stream'
const MISSING_MODEL_MESSAGE = 'Model object is not configured'
const CORS_ALLOW_ORIGIN = '*'

export function addCorsHeaders(headers: Headers): Headers {
  headers.set('access-control-allow-origin', CORS_ALLOW_ORIGIN)
  return headers
}

export function textResponse(body: string, status: number, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: addCorsHeaders(new Headers(headers)),
  })
}

function createModelHeaders(object: R2ObjectBody): Headers {
  const headers = new Headers({
    'content-type': MODEL_CONTENT_TYPE,
    'content-disposition': `inline; filename="${MODEL_FILENAME}"`,
    'cache-control': CACHE_CONTROL,
  })

  if (object.httpEtag) {
    headers.set('etag', object.httpEtag)
  }

  return addCorsHeaders(headers)
}

export async function createModelResponse(
  request: Request,
  env: NormalizedEnv,
  decision: ModelAccessDecision,
): Promise<Response> {
  if (decision === 'forbidden') {
    return textResponse('Forbidden', 403)
  }

  const objectKey = decision === 'real' ? env.realModelObjectKey : env.decoyModelObjectKey
  const object = await env.modelBucket.get(objectKey)
  if (object === null) {
    return textResponse(MISSING_MODEL_MESSAGE, 500, { 'content-type': 'text/plain;charset=UTF-8' })
  }

  return new Response(request.method === 'HEAD' ? null : object.body, {
    status: 200,
    headers: createModelHeaders(object),
  })
}
