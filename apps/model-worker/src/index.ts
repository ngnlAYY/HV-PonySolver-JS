import { handleRequest } from './request-router'
import type { Env } from './worker-types'

export { ModelDownloadQuota } from './model-download-quota'

const worker = {
  fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    return handleRequest(request, env)
  },
}

export type { Env, ModelBucket, ModelDownloadQuotaNamespace, ModelKeyStore } from './worker-types'
export default worker
