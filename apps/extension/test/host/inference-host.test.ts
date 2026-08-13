import { describe, expect, it, vi } from 'vitest'

import type { DetectorService, YoloParseResult } from '@hv-pony-solver/browser-core'

import { InferenceHost, type InferenceHostDependencies } from '../../src/host/inference-host'
import { PROTOCOL_VERSION } from '../../src/protocol/messages'

const detectionResult: YoloParseResult = {
  success: true,
  ponies: ['TS'],
  confidences: { TS: 0.91 },
  detections: [{ class_id: 0, confidence: 0.91 }],
  candidates: [{ class_id: 0, confidence: 0.91 }],
}

function dependencies(): InferenceHostDependencies {
  const detector: DetectorService = {
    prepare: vi.fn(async () => undefined),
    detect: vi.fn(async () => detectionResult),
    destroy: vi.fn(),
  }
  return {
    detector,
    verifyKey: vi.fn(async () => undefined),
    close: vi.fn(),
  }
}

describe('InferenceHost', () => {
  it('prepares and performs local detection without exposing model bytes', async () => {
    const deps = dependencies()
    const host = new InferenceHost(deps)

    await expect(
      host.handle({ protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-1' }),
    ).resolves.toMatchObject({ ok: true, requestId: 'prepare-1' })
    await expect(
      host.handle({
        protocol: PROTOCOL_VERSION,
        type: 'detect',
        requestId: 'detect-1',
        imageBase64: 'AQID',
        mimeType: 'image/png',
      }),
    ).resolves.toMatchObject({ ok: true, requestId: 'detect-1', result: detectionResult })
    expect(deps.detector.detect).toHaveBeenCalledWith(expect.any(Blob))
  })

  it('stores a candidate Key only after a verified model download', async () => {
    const deps = dependencies()
    const host = new InferenceHost(deps)

    await expect(
      host.handle({
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: 'verify-1',
        candidateKey: `  ${'a'.repeat(64)}  `,
      }),
    ).resolves.toMatchObject({ ok: true })

    expect(deps.verifyKey).toHaveBeenCalledWith('a'.repeat(64))
  })

  it('does not persist a Key when validation fails', async () => {
    const deps = dependencies()
    vi.mocked(deps.verifyKey!).mockRejectedValueOnce(new Error('HTTP 401'))
    const host = new InferenceHost(deps)

    await expect(
      host.handle({
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: 'verify-2',
        candidateKey: 'b'.repeat(64),
      }),
    ).resolves.toMatchObject({ ok: false, error: 'Error: HTTP 401' })
    expect(deps.verifyKey).toHaveBeenCalledTimes(1)
  })

  it('does not persist a Key when packaged inference initialization fails', async () => {
    const deps = dependencies()
    vi.mocked(deps.verifyKey!).mockRejectedValueOnce(new Error('WASM initialization failed'))
    const host = new InferenceHost(deps)

    await expect(
      host.handle({
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: 'verify-3',
        candidateKey: 'c'.repeat(64),
      }),
    ).resolves.toMatchObject({ ok: false, error: 'Error: WASM initialization failed' })
    expect(deps.verifyKey).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the host has no Key verifier', async () => {
    const deps = dependencies()
    const host = new InferenceHost({ detector: deps.detector })

    await expect(
      host.handle({
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: 'verify-packaged',
        candidateKey: 'd'.repeat(64),
      }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('不支持模型 Key') })
  })

  it('destroys the detector and closes extra dependencies', () => {
    const deps = dependencies()
    const host = new InferenceHost(deps)
    host.destroy()
    expect(deps.detector.destroy).toHaveBeenCalledTimes(1)
    expect(deps.close).toHaveBeenCalledTimes(1)
  })
})
