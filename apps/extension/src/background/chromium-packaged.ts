import { registerBroker } from './broker'
import { ensureOffscreenDocument } from './chromium-offscreen'
import { registerOpenOptionsAction, sendRuntimeMessage } from '../platform/webextension'
import {
  OFFSCREEN_MESSAGE_TYPE,
  isHostResponse,
  type HostRequest,
  type HostResponse,
} from '../protocol/messages'

async function invokeOffscreenHost(request: HostRequest): Promise<HostResponse> {
  await ensureOffscreenDocument()
  const response = await sendRuntimeMessage({ type: OFFSCREEN_MESSAGE_TYPE, request })
  if (!isHostResponse(response) || response.requestId !== request.requestId) {
    throw new Error('Offscreen 推理 Host 返回无效消息')
  }
  return response
}

registerBroker(invokeOffscreenHost, { allowOptions: false })
registerOpenOptionsAction()
