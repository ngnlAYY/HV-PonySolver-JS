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
    expect(deps.detector.detect).toHaveBeenCalledWith(expect.any(Blob), expect.any(AbortSignal))
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

    expect(deps.verifyKey).toHaveBeenCalledWith('a'.repeat(64), expect.any(AbortSignal))
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
    host.destroy()
    expect(deps.detector.destroy).toHaveBeenCalledTimes(1)
    expect(deps.close).toHaveBeenCalledTimes(1)
  })

  it('aborts every in-flight request and suppresses success after destroy', async () => {
    const deps = dependencies()
    let resolveDetect: ((result: YoloParseResult) => void) | undefined
    let receivedSignal: AbortSignal | undefined
    vi.mocked(deps.detector.detect).mockImplementation(
      async (_blob, signal) =>
        new Promise<YoloParseResult>((resolve) => {
          receivedSignal = signal
          resolveDetect = resolve
        }),
    )
    const host = new InferenceHost(deps)
    const responsePromise = host.handle({
      protocol: PROTOCOL_VERSION,
      type: 'detect',
      requestId: 'detect-destroy',
      imageBase64: 'AQID',
      mimeType: 'image/png',
    })
    await vi.waitFor(() => expect(receivedSignal).toBeInstanceOf(AbortSignal))

    host.destroy()
    expect(receivedSignal?.aborted).toBe(true)
    resolveDetect?.(detectionResult)

    await expect(responsePromise).resolves.toMatchObject({
      ok: false,
      requestId: 'detect-destroy',
      error: expect.stringContaining('推理 Host 已关闭'),
    })
  })

  it('rejects an already-aborted caller before invoking the detector', async () => {
    const deps = dependencies()
    const host = new InferenceHost(deps)
    const controller = new AbortController()
    controller.abort()

    await expect(
      host.handle({ protocol: PROTOCOL_VERSION, type: 'prepare', requestId: 'prepare-aborted' }, controller.signal),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('推理请求已取消') })
    expect(deps.detector.prepare).not.toHaveBeenCalled()
  })
})
