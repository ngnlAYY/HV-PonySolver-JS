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
  signal: AbortSignal | undefined
  abort: (() => void) | undefined
}>

export class RemoteDetectorClient implements DetectorService {
  private port: ExtensionPort | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private requestSequence = 0
  private destroyed = false

  constructor(private readonly statusSink: InferenceStatusSink) {}

  async prepare(signal?: AbortSignal): Promise<void> {
    this.assertNotAborted(signal)
    const startedAt = Date.now()
    this.statusSink.setStatus({ session: '初始化中' })
    try {
      await this.request({
        protocol: PROTOCOL_VERSION,
        type: 'prepare',
        requestId: this.nextRequestId(),
      }, 95_000, signal)
      this.assertNotAborted(signal)
      if (!this.destroyed) {
        this.statusSink.setSessionReady(Date.now() - startedAt)
      }
    } catch (error) {
      if (!this.destroyed && !signal?.aborted) {
        this.statusSink.setStatus({ session: '错误' })
      }
      throw error
    }
  }

  async detect(blob: Blob, signal?: AbortSignal): Promise<YoloParseResult> {
    this.assertNotAborted(signal)
    let image: Awaited<ReturnType<typeof encodeImage>>
    try {
      image = await encodeImage(blob)
    } catch (error) {
      throw new Error(`验证码图片编码失败: ${formatErrorMessage(error)}`, { cause: error })
    }
    this.assertNotAborted(signal)
    const response = await this.request(
      {
        protocol: PROTOCOL_VERSION,
        type: 'detect',
        requestId: this.nextRequestId(),
        ...image,
      },
      35_000,
      signal,
    )
    if (!response.result) {
      throw new Error('扩展推理 Host 未返回识别结果')
    }
    return response.result
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.disconnectPort(new Error('扩展推理连接已关闭'))
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
    port.onMessage.addListener((message) => this.handleMessage(port, message))
    port.onDisconnect.addListener(() => this.handleDisconnect(port))
    this.port = port
    return port
  }

  private request(request: HostRequest, timeoutMs: number, signal?: AbortSignal): Promise<HostSuccessResponse> {
    if (signal?.aborted) {
      return Promise.reject(new Error('扩展推理请求已取消'))
    }
    return new Promise<HostResponse>((resolve, reject) => {
      let port: ExtensionPort
      try {
        port = this.getPort()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      const timeoutId = setTimeout(() => {
        if (this.pending.has(request.requestId)) {
          this.disconnectPort(new Error('扩展推理请求超时'))
        }
      }, timeoutMs)
      const abort = signal
        ? (): void => {
            if (this.pending.has(request.requestId)) {
              this.disconnectPort(new Error('扩展推理请求已取消'))
            }
          }
        : undefined
      if (signal && abort) {
        signal.addEventListener('abort', abort, { once: true })
      }
      this.pending.set(request.requestId, { resolve, reject, timeoutId, signal, abort })
      // AbortSignal does not replay an abort that races with listener installation.
      // Recheck after publishing the pending entry so the abort handler can own cleanup.
      if (signal?.aborted) {
        abort?.()
        return
      }
      try {
        port.postMessage(request)
      } catch (error) {
        this.disconnectPort(error instanceof Error ? error : new Error(String(error)))
      }
    }).then((response) => {
      if (!response.ok) {
        throw new Error(response.error)
      }
      return response
    })
  }

  private handleMessage(port: ExtensionPort, message: unknown): void {
    if (port !== this.port) {
      return
    }
    if (!isHostResponse(message)) {
      return
    }
    const pending = this.takePending(message.requestId)
    if (!pending) {
      return
    }
    pending.resolve(message)
  }

  private handleDisconnect(port: ExtensionPort): void {
    if (port !== this.port) {
      return
    }
    this.port = null
    this.statusSink.setStatus({ session: '连接断开' })
    this.rejectPending(new Error('扩展推理连接已断开'))
  }

  private rejectPending(error: Error): void {
    for (const requestId of [...this.pending.keys()]) {
      const pending = this.takePending(requestId)
      if (!pending) {
        continue
      }
      pending.reject(error)
    }
  }

  private takePending(requestId: string): PendingRequest | undefined {
    const pending = this.pending.get(requestId)
    if (!pending) {
      return undefined
    }
    this.pending.delete(requestId)
    clearTimeout(pending.timeoutId)
    if (pending.abort) {
      pending.signal?.removeEventListener('abort', pending.abort)
    }
    return pending
  }

  private disconnectPort(error: Error): void {
    const port = this.port
    this.port = null
    this.rejectPending(error)
    if (port) {
      try {
        port.disconnect()
      } catch {
        // The client already discarded this Port and will reconnect on demand.
      }
    }
  }

  private assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('扩展推理请求已取消')
    }
  }
}
