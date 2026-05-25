import { normalizeEnv } from './env'
import { textResponse } from './model-response'
import { handleRequest } from './request-router'
import type { Env } from './worker-types'

export type { Env, ModelBucket, ModelKeyStore } from './worker-types'

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, normalizeEnv(env))
    } catch {
      return textResponse(request, 'Internal Server Error', 500, { 'content-type': 'text/plain;charset=UTF-8' })
    }
  },
} satisfies ExportedHandler<Env>
