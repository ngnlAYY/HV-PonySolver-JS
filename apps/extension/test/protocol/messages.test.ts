import { describe, expect, it } from 'vitest'

import {
  MAX_IMAGE_BYTE_LENGTH,
  PROTOCOL_VERSION,
  decodeImage,
  encodeImage,
  isHostRequest,
  isHostResponse,
} from '../../src/protocol/messages'

describe('extension protocol', () => {
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
})
