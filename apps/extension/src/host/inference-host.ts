import type { DetectorService } from '@hv-pony-solver/browser-core/inference/inference-types'
import { formatErrorMessage } from '@hv-pony-solver/browser-core/utils/errors'

import {
  decodeImage,
  errorResponse,
  successResponse,
  type HostRequest,
  type HostResponse,
  type KeyIntentRequest,
} from '../protocol/messages'

export type InferenceHostDependencies = Readonly<{
  detector: DetectorService
  verifyKey?(candidateKey: string, signal: AbortSignal): Promise<string | undefined>
  clearKey?(signal: AbortSignal): Promise<void>
  close?(): void | Promise<void>
}>

type ActiveKeyIntent = Readonly<{
  controller: AbortController
  generation: number
}>

export class InferenceHost {
  private readonly destroyController = new AbortController()
  private keyOperationTail: Promise<void> = Promise.resolve()
  private activeKeyIntent: ActiveKeyIntent | null = null
  private keyGeneration = 0
  private destroyed = false

  constructor(private readonly dependencies: InferenceHostDependencies) {}

  async handle(request: HostRequest, callerSignal?: AbortSignal): Promise<HostResponse> {
    if (request.type === 'verify-key' || request.type === 'clear-key') {
      return this.handleKeyIntent(request, callerSignal)
    }
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
      const result = await this.dependencies.detector.detect(decodeImage(request), controller.signal)
      this.assertActive(callerSignal)
      return successResponse(request.requestId, result)
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
    this.keyGeneration += 1
    this.activeKeyIntent?.controller.abort(new Error('推理 Host 已关闭'))
    this.activeKeyIntent = null
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

  private async handleKeyIntent(request: KeyIntentRequest, callerSignal?: AbortSignal): Promise<HostResponse> {
    try {
      this.assertActive(callerSignal)
    } catch (error) {
      return errorResponse(request.requestId, formatErrorMessage(error))
    }

    const generation = ++this.keyGeneration
    this.activeKeyIntent?.controller.abort(new Error('模型 Key 操作已被更新操作取代'))
    const controller = new AbortController()
    const intent: ActiveKeyIntent = { controller, generation }
    this.activeKeyIntent = intent
    const abortFromCaller = (): void => controller.abort(new Error('模型 Key 操作已取消'))
    const abortFromDestroy = (): void => controller.abort(new Error('推理 Host 已关闭'))
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
    this.destroyController.signal.addEventListener('abort', abortFromDestroy, { once: true })
    if (callerSignal?.aborted) {
      abortFromCaller()
    } else if (this.destroyController.signal.aborted) {
      abortFromDestroy()
    }

    const operation = this.keyOperationTail.then(async () => {
      this.assertKeyIntentActive(intent, callerSignal)
      let notice: string | undefined
      if (request.type === 'verify-key') {
        if (!this.dependencies.verifyKey) {
          throw new Error('当前扩展版本不支持模型 Key')
        }
        notice = await this.dependencies.verifyKey(request.candidateKey.trim(), controller.signal)
      } else {
        if (!this.dependencies.clearKey) {
          throw new Error('当前扩展版本不支持清除模型 Key')
        }
        await this.dependencies.clearKey(controller.signal)
      }
      this.assertKeyIntentActive(intent, callerSignal)
      return notice
    })
    this.keyOperationTail = operation.then(
      () => undefined,
      () => undefined,
    )

    try {
      const notice = await operation
      return successResponse(request.requestId, undefined, notice)
    } catch (error) {
      return errorResponse(request.requestId, formatErrorMessage(error))
    } finally {
      callerSignal?.removeEventListener('abort', abortFromCaller)
      this.destroyController.signal.removeEventListener('abort', abortFromDestroy)
      if (this.activeKeyIntent === intent) {
        this.activeKeyIntent = null
      }
    }
  }

  private assertKeyIntentActive(intent: ActiveKeyIntent, callerSignal?: AbortSignal): void {
    this.assertActive(callerSignal)
    if (
      intent.generation !== this.keyGeneration ||
      this.activeKeyIntent !== intent ||
      intent.controller.signal.aborted
    ) {
      throw new Error('模型 Key 操作已取消')
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
