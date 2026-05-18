import { selectModelAccess } from './model-access'
import { createModelResponse, textResponse } from './model-response'
import type { NormalizedEnv } from './worker-types'

const ALLOWED_METHODS = 'GET, HEAD'

function isModelMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

export async function handleRequest(request: Request, env: NormalizedEnv): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname !== env.publicModelPath) {
    return textResponse('Not Found', 404)
  }

  if (!isModelMethod(request.method)) {
    return textResponse('Method Not Allowed', 405, { allow: ALLOWED_METHODS })
  }

  const decision = await selectModelAccess(request, env)
  return createModelResponse(request, env, decision)
}
