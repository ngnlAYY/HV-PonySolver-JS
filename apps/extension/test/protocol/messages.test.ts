import { describe, expect, it } from 'vitest'

import {
  MAX_IMAGE_BYTE_LENGTH,
  PROTOCOL_VERSION,
  cancelRequestFor,
  decodeImage,
  encodeImage,
  isCancelRequest,
  isHostRequest,
  isHostResponse,
  isOffscreenCancelRequest,
  isOffscreenRequest,
  isOffscreenStatusMessage,
  isPortStatusMessage,
  offscreenStatusMessage,
  portStatusMessage,
  successResponse,
} from '../../src/protocol/messages'

describe('extension protocol', () => {
  it('validates request-scoped cancel messages', () => {
    const cancel = cancelRequestFor('detect-1', 'cancel-1')
    expect(cancel).toEqual({
      protocol: PROTOCOL_VERSION,
      type: 'cancel',
      requestId: 'cancel-1',
      cancelRequestId: 'detect-1',
    })
    expect(isCancelRequest(JSON.parse(JSON.stringify(cancel)))).toBe(true)
    // A cancel is a control message, never a Host request of its own.
    expect(isHostRequest(JSON.parse(JSON.stringify(cancel)))).toBe(false)

    expect(isCancelRequest({ protocol: PROTOCOL_VERSION, type: 'cancel', requestId: 'cancel-2' })).toBe(false)
    expect(
      isCancelRequest({
        protocol: PROTOCOL_VERSION,
        type: 'cancel',
        requestId: 'cancel-3',
        cancelRequestId: 'detect-3',
        extra: 'forbidden',
      }),
    ).toBe(false)
    expect(
      isCancelRequest({
        protocol: PROTOCOL_VERSION,
        type: 'cancel',
        requestId: 'cancel-4',
        cancelRequestId: 'not a valid id!',
      }),
    ).toBe(false)
    expect(isCancelRequest({ protocol: 'unknown', type: 'cancel', requestId: 'cancel-5', cancelRequestId: 'x' })).toBe(
      false,
    )
  })

  it('validates one-way Host status notifications on both hops', () => {
    const portMessage = portStatusMessage({ model: '下载中', session: '初始化中' })
    expect(portMessage).toEqual({
      protocol: PROTOCOL_VERSION,
      type: 'status',
      status: { model: '下载中', session: '初始化中' },
    })
    expect(isPortStatusMessage(JSON.parse(JSON.stringify(portMessage)))).toBe(true)
    // A status notification is not a Host response and must not settle one.
    expect(isHostResponse(JSON.parse(JSON.stringify(portMessage)))).toBe(false)

    const offscreenMessage = offscreenStatusMessage({ session: '初始化中' })
    expect(isOffscreenStatusMessage(JSON.parse(JSON.stringify(offscreenMessage)))).toBe(true)

    expect(isPortStatusMessage({ protocol: PROTOCOL_VERSION, type: 'status', status: {} })).toBe(false)
    expect(isPortStatusMessage({ protocol: PROTOCOL_VERSION, type: 'status', status: { unknown: 'x' } })).toBe(false)
    expect(isPortStatusMessage({ protocol: PROTOCOL_VERSION, type: 'status', status: { model: '' } })).toBe(false)
    expect(
      isPortStatusMessage({
        protocol: PROTOCOL_VERSION,
        type: 'status',
        status: { model: 'x'.repeat(201) },
      }),
    ).toBe(false)
    expect(
      isOffscreenStatusMessage({
        type: 'hv-pony-solver:offscreen-request',
        operation: 'status',
        status: { model: 'x' },
        requestId: 'extra-key',
      }),
    ).toBe(false)
    expect(
      isOffscreenStatusMessage({
        type: 'hv-pony-solver:offscreen-request',
        operation: 'cancel',
        requestId: 'sw-1',
      }),
    ).toBe(false)
  })

  it('round-trips a bounded image through JSON-safe base64', async () => {
    const source = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    const encoded = await encodeImage(source)
    const request = {
      protocol: PROTOCOL_VERSION,
      type: 'detect' as const,
      requestId: 'request-1',
      ...encoded,
    }

    expect(isHostRequest(JSON.parse(JSON.stringify(request)))).toBe(true)
    const decoded = decodeImage(request)
    expect(decoded.type).toBe('image/png')
    expect([...new Uint8Array(await decoded.arrayBuffer())]).toEqual([1, 2, 3, 4])
  })

  it('rejects oversized, malformed, and credential-shaped messages', () => {
    expect(
      isHostRequest({
        protocol: PROTOCOL_VERSION,
        type: 'detect',
        requestId: 'request-1',
        imageBase64: 'A'.repeat(Math.ceil(MAX_IMAGE_BYTE_LENGTH / 3) * 4 + 4),
        mimeType: 'image/png',
      }),
    ).toBe(false)
    expect(
      isHostRequest({
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: 'request-2',
        candidateKey: '',
      }),
    ).toBe(false)
    expect(
      isHostRequest({
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: 'request-2b',
        candidateKey: 'not-a-64-character-hex-key',
      }),
    ).toBe(false)
    expect(isHostRequest({ protocol: 'unknown', type: 'prepare', requestId: 'request-3' })).toBe(false)
    expect(
      isHostRequest({
        protocol: PROTOCOL_VERSION,
        type: 'detect',
        requestId: 'request-4',
        imageBase64: 'AQID',
        mimeType: 'image/svg+xml',
      }),
    ).toBe(false)
    expect(
      isHostRequest({
        protocol: PROTOCOL_VERSION,
        type: 'prepare',
        requestId: 'request-5',
        arbitraryUrl: 'https://evil.invalid/',
      }),
    ).toBe(false)
  })

  it('validates exact clear-key and offscreen request/cancel operation schemas', () => {
    const clearRequest = {
      protocol: PROTOCOL_VERSION,
      type: 'clear-key',
      requestId: 'clear-1',
    } as const
    expect(isHostRequest(clearRequest)).toBe(true)
    expect(isHostRequest({ ...clearRequest, candidateKey: 'a'.repeat(64) })).toBe(false)

    expect(
      isOffscreenRequest({
        type: 'hv-pony-solver:offscreen-request',
        operation: 'request',
        requestId: 'offscreen-1',
        request: clearRequest,
      }),
    ).toBe(true)
    expect(
      isOffscreenCancelRequest({
        type: 'hv-pony-solver:offscreen-request',
        operation: 'cancel',
        requestId: 'offscreen-1',
      }),
    ).toBe(true)
    expect(
      isOffscreenCancelRequest({
        type: 'hv-pony-solver:offscreen-request',
        operation: 'cancel',
        requestId: 'offscreen-1',
        request: clearRequest,
      }),
    ).toBe(false)
  })

  it('validates complete inference results and bounded errors', () => {
    expect(
      isHostResponse({
        protocol: PROTOCOL_VERSION,
        type: 'result',
        requestId: 'request-1',
        ok: true,
        result: {
          success: true,
          ponies: ['TS'],
          confidences: { TS: 0.9 },
          detections: [{ class_id: 0, confidence: 0.9 }],
          candidates: [{ class_id: 0, confidence: 0.9 }],
        },
      }),
    ).toBe(true)
    expect(
      isHostResponse({
        protocol: PROTOCOL_VERSION,
        type: 'result',
        requestId: 'request-1',
        ok: true,
        result: { success: true, ponies: ['INVALID'] },
      }),
    ).toBe(false)
  })

  it('accepts a bounded notice on success and rejects malformed ones', () => {
    const base = { protocol: PROTOCOL_VERSION, type: 'result', requestId: 'request-1', ok: true } as const

    expect(isHostResponse({ ...base, notice: '模型 Key 有效并已安全保存' })).toBe(true)
    expect(isHostResponse({ ...base, notice: 'x'.repeat(1000) })).toBe(true)
    expect(isHostResponse({ ...base, notice: undefined })).toBe(true)

    expect(isHostResponse({ ...base, notice: '' })).toBe(false)
    expect(isHostResponse({ ...base, notice: 'x'.repeat(1001) })).toBe(false)
    expect(isHostResponse({ ...base, notice: 42 })).toBe(false)
    // Unknown keys must still be rejected now that the key set is no longer exact.
    expect(isHostResponse({ ...base, notice: 'ok', unexpected: 'value' })).toBe(false)
    expect(isHostResponse({ ...base, unexpected: 'value' })).toBe(false)
  })

  it('rejects a notice on an error response', () => {
    expect(
      isHostResponse({
        protocol: PROTOCOL_VERSION,
        type: 'result',
        requestId: 'request-1',
        ok: false,
        error: '模型 Key 无效',
        notice: '不应出现在错误响应上',
      }),
    ).toBe(false)
  })

  it('omits notice unless one is supplied and truncates an overlong one', () => {
    expect(successResponse('request-1')).toEqual({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'request-1',
      ok: true,
    })
    expect(successResponse('request-1', undefined, '额度已用完')).toEqual({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'request-1',
      ok: true,
      notice: '额度已用完',
    })
    // An empty notice must not create the key at all.
    expect(successResponse('request-1', undefined, '')).not.toHaveProperty('notice')

    const truncated = successResponse('request-1', undefined, 'x'.repeat(1500))
    expect(truncated.notice).toHaveLength(1000)
    expect(isHostResponse(truncated)).toBe(true)
  })
})
