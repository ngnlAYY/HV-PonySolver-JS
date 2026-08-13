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
  verifyKey?(candidateKey: string, signal: AbortSignal): Promise<void>
  close?(): void | Promise<void>
}>

export class InferenceHost {
  private readonly destroyController = new AbortController()
  private destroyed = false

  constructor(private readonly dependencies: InferenceHostDependencies) {}

  async handle(request: HostRequest, callerSignal?: AbortSignal): Promise<HostResponse> {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    callerSignal?.addEventListener('abort', abort, { once: true })
    this.destroyController.signal.addEventListener('abort', abort, { once: true })
    try {
      this.assertActive(callerSignal)
      if (request.type === 'prepare') {
        await this.dependencies.detector.prepare(controller.signal)
        this.assertActive(callerSignal)
        return successResponse(request.requestId)
      }
      if (request.type === 'detect') {
        const result = await this.dependencies.detector.detect(decodeImage(request), controller.signal)
        this.assertActive(callerSignal)
        return successResponse(request.requestId, result)
      }
      if (!this.dependencies.verifyKey) {
        throw new Error('当前扩展版本不支持模型 Key')
      }
      await this.dependencies.verifyKey(request.candidateKey.trim(), controller.signal)
      this.assertActive(callerSignal)
      return successResponse(request.requestId)
    } catch (error) {
      return errorResponse(request.requestId, formatErrorMessage(error))
    } finally {
      callerSignal?.removeEventListener('abort', abort)
      this.destroyController.signal.removeEventListener('abort', abort)
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.destroyController.abort()
    this.dependencies.detector.destroy()
    try {
      const closeResult = this.dependencies.close?.()
      if (closeResult) {
        void closeResult.catch(() => undefined)
      }
    } catch {
      // Destroy is terminal and must not leak cleanup failures.
    }
  }

  private assertActive(callerSignal?: AbortSignal): void {
    if (this.destroyed || this.destroyController.signal.aborted) {
      throw new Error('推理 Host 已关闭')
    }
    if (callerSignal?.aborted) {
      throw new Error('推理请求已取消')
    }
  }
}
