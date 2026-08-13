import type { DetectorService } from '@hv-pony-solver/browser-core/inference/inference-types'
import { formatErrorMessage } from '@hv-pony-solver/browser-core/utils/errors'

import {
  decodeImage,
  errorResponse,
  successResponse,
  type HostRequest,
  type HostResponse,
} from '../protocol/messages'

export type InferenceHostDependencies = Readonly<{
  detector: DetectorService
  verifyKey?(candidateKey: string): Promise<void>
  close?(): void
}>

export class InferenceHost {
  constructor(private readonly dependencies: InferenceHostDependencies) {}

  async handle(request: HostRequest): Promise<HostResponse> {
    try {
      if (request.type === 'prepare') {
        await this.dependencies.detector.prepare()
        return successResponse(request.requestId)
      }
      if (request.type === 'detect') {
        const result = await this.dependencies.detector.detect(decodeImage(request))
        return successResponse(request.requestId, result)
      }
      if (!this.dependencies.verifyKey) {
        throw new Error('当前扩展版本不支持模型 Key')
      }
      await this.dependencies.verifyKey(request.candidateKey.trim())
      return successResponse(request.requestId)
    } catch (error) {
      return errorResponse(request.requestId, formatErrorMessage(error))
    }
  }

  destroy(): void {
    this.dependencies.detector.destroy()
    this.dependencies.close?.()
  }
}
