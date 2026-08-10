import { handleRequest } from './request-router'
import type { Env } from './worker-types'

const worker = {
  fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    return handleRequest(request, env)
  },
}

export type { Env, ModelBucket, ModelKeyStore } from './worker-types'
export default worker
