import { MODEL_MONTHLY_DOWNLOAD_LIMIT } from '@hv-pony-solver/shared'

export class ModelDownloadQuotaExceededError extends Error {
  readonly retryAfterSeconds: number | null

  constructor(retryAfterSeconds: number | null) {
    super(`本月 ${MODEL_MONTHLY_DOWNLOAD_LIMIT} 次模型下载额度已用完`)
    this.name = 'ModelDownloadQuotaExceededError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}
