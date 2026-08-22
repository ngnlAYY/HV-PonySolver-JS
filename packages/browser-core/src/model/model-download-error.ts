import { MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

export class ModelDownloadQuotaExceededError extends Error {
  readonly retryAfterSeconds: number | null

  constructor(retryAfterSeconds: number | null) {
    super(`本月 ${MODEL_MONTHLY_DOWNLOAD_LIMIT} 次模型下载额度已用完`)
    this.name = 'ModelDownloadQuotaExceededError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export class ModelAccessKeyRejectedError extends Error {
  constructor() {
    super('模型 Key 无效或已失效，请在设置中重新验证 Key')
    this.name = 'ModelAccessKeyRejectedError'
  }
}
