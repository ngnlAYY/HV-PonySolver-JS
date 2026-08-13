import { registerOpenOptionsAction, sendRuntimeMessage } from '../platform/webextension'
import {
  OFFSCREEN_MESSAGE_TYPE,
  isHostResponse,
  type HostRequest,
  type HostResponse,
} from '../protocol/messages'
import { registerBroker, type BrokerPolicy } from './broker'
import { ensureOffscreenDocument } from './chromium-offscreen'

async function invokeOffscreenHost(request: HostRequest, signal: AbortSignal): Promise<HostResponse> {
  if (signal.aborted) {
    throw new Error('推理请求已取消')
  }
  await ensureOffscreenDocument()
  if (signal.aborted) {
    throw new Error('推理请求已取消')
  }
  const response = await sendRuntimeMessage({ type: OFFSCREEN_MESSAGE_TYPE, request })
  if (!isHostResponse(response) || response.requestId !== request.requestId) {
    throw new Error('Offscreen 推理 Host 返回无效消息')
  }
  if (signal.aborted) {
    throw new Error('推理请求已取消')
  }
  return response
}

export function registerChromiumBackground(policy: BrokerPolicy = { allowOptions: true }): void {
  registerBroker(invokeOffscreenHost, policy)
  registerOpenOptionsAction()
}
