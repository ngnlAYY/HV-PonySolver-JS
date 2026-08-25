import type { DetectorService } from '@hv-pony-solver/browser-core/inference/inference-types'
import { isPermanentModelError } from '@hv-pony-solver/browser-core/model/permanent-model-error'
import { formatErrorMessage } from '@hv-pony-solver/browser-core/utils/errors'

import {
  decodeImage,
  errorResponse,
  successResponse,
  type HostRequest,
  type HostResponse,
  type SerializedModelRequest,
} from '../protocol/messages'

export type InferenceHostDependencies = Readonly<{
  detector: DetectorService
  verifyKey?(candidateKey: string, signal: AbortSignal): Promise<string | undefined>
  clearKey?(signal: AbortSignal): Promise<void>
  downloadModel?(signal: AbortSignal): Promise<string | undefined>
  queryModelQuota?(signal: AbortSignal): Promise<string | undefined>
  close?(): void | Promise<void>
}>

type ActiveModelIntent = Readonly<{
  controller: AbortController
  generation: number
}>

export class InferenceHost {
  private readonly destroyController = new AbortController()
  private modelOperationTail: Promise<void> = Promise.resolve()
  private activeModelIntent: ActiveModelIntent | null = null
  private modelOperationGeneration = 0
  private destroyed = false

  constructor(private readonly dependencies: InferenceHostDependencies) {}

  async handle(request: HostRequest, callerSignal?: AbortSignal): Promise<HostResponse> {
    if (
      request.type === 'verify-key' ||
      request.type === 'clear-key' ||
      request.type === 'download-model' ||
      request.type === 'query-model-quota'
    ) {
      return this.handleModelIntent(request, callerSignal)
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
      return errorResponse(
        request.requestId,
        formatErrorMessage(error),
        isPermanentModelError(error) ? 'permanent-model' : 'transient',
      )
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
    this.modelOperationGeneration += 1
    this.activeModelIntent?.controller.abort(new Error('推理 Host 已关闭'))
    this.activeModelIntent = null
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

  private async handleModelIntent(request: SerializedModelRequest, callerSignal?: AbortSignal): Promise<HostResponse> {
    try {
      this.assertActive(callerSignal)
    } catch (error) {
      return errorResponse(request.requestId, formatErrorMessage(error))
    }

    const generation = ++this.modelOperationGeneration
    this.activeModelIntent?.controller.abort(new Error('模型管理操作已被更新操作取代'))
    const controller = new AbortController()
    const intent: ActiveModelIntent = { controller, generation }
    this.activeModelIntent = intent
    const abortFromCaller = (): void => controller.abort(new Error('模型管理操作已取消'))
    const abortFromDestroy = (): void => controller.abort(new Error('推理 Host 已关闭'))
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
    this.destroyController.signal.addEventListener('abort', abortFromDestroy, { once: true })
    if (callerSignal?.aborted) {
      abortFromCaller()
    } else if (this.destroyController.signal.aborted) {
      abortFromDestroy()
    }

    const operation = this.modelOperationTail.then(async () => {
      this.assertModelIntentActive(intent, callerSignal)
      let notice: string | undefined
      if (request.type === 'verify-key') {
        if (!this.dependencies.verifyKey) {
          throw new Error('当前扩展版本不支持模型 Key')
        }
        notice = await this.dependencies.verifyKey(request.candidateKey.trim(), controller.signal)
      } else if (request.type === 'clear-key') {
        if (!this.dependencies.clearKey) {
          throw new Error('当前扩展版本不支持清除模型 Key')
        }
        await this.dependencies.clearKey(controller.signal)
      } else if (request.type === 'download-model') {
        if (!this.dependencies.downloadModel) {
          throw new Error('当前扩展版本不支持手动下载模型')
        }
        notice = await this.dependencies.downloadModel(controller.signal)
      } else {
        if (!this.dependencies.queryModelQuota) {
          throw new Error('当前扩展版本不支持查询模型下载次数')
        }
        notice = await this.dependencies.queryModelQuota(controller.signal)
      }
      this.assertModelIntentActive(intent, callerSignal)
      return notice
    })
    this.modelOperationTail = operation.then(
      () => undefined,
      () => undefined,
    )

    try {
      const notice = await operation
      return successResponse(request.requestId, undefined, notice)
    } catch (error) {
      return errorResponse(
        request.requestId,
        formatErrorMessage(error),
        isPermanentModelError(error) ? 'permanent-model' : 'transient',
      )
    } finally {
      callerSignal?.removeEventListener('abort', abortFromCaller)
      this.destroyController.signal.removeEventListener('abort', abortFromDestroy)
      if (this.activeModelIntent === intent) {
        this.activeModelIntent = null
      }
    }
  }

  private assertModelIntentActive(intent: ActiveModelIntent, callerSignal?: AbortSignal): void {
    this.assertActive(callerSignal)
    if (
      intent.generation !== this.modelOperationGeneration ||
      this.activeModelIntent !== intent ||
      intent.controller.signal.aborted
    ) {
      throw new Error('模型管理操作已取消')
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
