import { registerBroker } from './broker'
import { registerOpenOptionsAction } from '../platform/webextension'
import { errorResponse, successResponse } from '../protocol/messages'

registerBroker(async (request) => {
  if (request.type === 'verify-key') {
    return errorResponse(request.requestId, '测试 Host 不接受模型 Key')
  }
  if (request.type === 'detect') {
    return successResponse(request.requestId, {
      success: true,
      ponies: ['TS'],
      confidences: { TS: 0.99 },
      detections: [{ class_id: 0, confidence: 0.99 }],
      candidates: [{ class_id: 0, confidence: 0.99 }],
    })
  }
  return successResponse(request.requestId)
})

registerOpenOptionsAction()
