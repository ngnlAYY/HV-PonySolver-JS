import type {
  DetectorService,
  YoloParseResult,
} from '@hv-pony-solver/browser-core/inference/inference-types'
import type { InferenceStatusSink } from '@hv-pony-solver/browser-core/status-panel/status-panel-types'
import { formatErrorMessage } from '@hv-pony-solver/browser-core/utils/errors'

import { runtimeConnect, type ExtensionPort } from '../platform/webextension'
import {
  CONTENT_PORT_NAME,
  PROTOCOL_VERSION,
  encodeImage,
  isHostResponse,
  type HostRequest,
  type HostResponse,
  type HostSuccessResponse,
} from '../protocol/messages'

type PendingRequest = Readonly<{
  resolve(response: HostResponse): void
  reject(error: Error): void
  timeoutId: ReturnType<typeof setTimeout>
}>

export class RemoteDetectorClient implements DetectorService {
  private port: ExtensionPort | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private requestSequence = 0
  private destroyed = false

  constructor(private readonly statusSink: InferenceStatusSink) {}

  async prepare(): Promise<void> {
    const startedAt = Date.now()
    this.statusSink.setStatus({ session: '初始化中' })
    try {
      await this.request({
        protocol: PROTOCOL_VERSION,
        type: 'prepare',
        requestId: this.nextRequestId(),
      }, 95_000)
      this.statusSink.setSessionReady(Date.now() - startedAt)
    } catch (error) {
      this.statusSink.setStatus({ session: '错误' })
      throw error
    }
  }

  async detect(blob: Blob): Promise<YoloParseResult> {
    let image: Awaited<ReturnType<typeof encodeImage>>
    try {
      image = await encodeImage(blob)
    } catch (error) {
      throw new Error(`验证码图片编码失败: ${formatErrorMessage(error)}`, { cause: error })
    }
    const response = await this.request(
      {
        protocol: PROTOCOL_VERSION,
        type: 'detect',
        requestId: this.nextRequestId(),
        ...image,
      },
      35_000,
    )
    if (!response.result) {
      throw new Error('扩展推理 Host 未返回识别结果')
    }
    return response.result
  }

  destroy(): void {
    this.destroyed = true
    this.port?.disconnect()
    this.port = null
    this.rejectPending(new Error('扩展推理连接已关闭'))
  }

  private nextRequestId(): string {
    this.requestSequence += 1
    return `${Date.now().toString(36)}-${this.requestSequence.toString(36)}`
  }

  private getPort(): ExtensionPort {
    if (this.destroyed) {
      throw new Error('扩展推理连接已关闭')
    }
    if (this.port) {
      return this.port
    }
    const port = runtimeConnect(CONTENT_PORT_NAME)
    port.onMessage.addListener(this.handleMessage)
    port.onDisconnect.addListener(this.handleDisconnect)
    this.port = port
    return port
  }

  private request(request: HostRequest, timeoutMs: number): Promise<HostSuccessResponse> {
    return new Promise<HostResponse>((resolve, reject) => {
      let port: ExtensionPort
      try {
        port = this.getPort()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      const timeoutId = setTimeout(() => {
        this.pending.delete(request.requestId)
        reject(new Error('扩展推理请求超时'))
      }, timeoutMs)
      this.pending.set(request.requestId, { resolve, reject, timeoutId })
      try {
        port.postMessage(request)
      } catch (error) {
        clearTimeout(timeoutId)
        this.pending.delete(request.requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }).then((response) => {
      if (!response.ok) {
        throw new Error(response.error)
      }
      return response
    })
  }

  private readonly handleMessage = (message: unknown): void => {
    if (!isHostResponse(message)) {
      return
    }
    const pending = this.pending.get(message.requestId)
    if (!pending) {
      return
    }
    clearTimeout(pending.timeoutId)
    this.pending.delete(message.requestId)
    pending.resolve(message)
  }

  private readonly handleDisconnect = (): void => {
    this.port = null
    this.statusSink.setStatus({ session: '连接断开' })
    this.rejectPending(new Error('扩展推理连接已断开'))
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
