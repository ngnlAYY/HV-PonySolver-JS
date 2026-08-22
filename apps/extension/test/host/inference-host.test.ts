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
    clearKey: vi.fn(async () => undefined),
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

  it('relays a verifier notice to the caller and omits it otherwise', async () => {
    const deps = dependencies()
    vi.mocked(deps.verifyKey!).mockResolvedValueOnce('模型 Key 有效并已安全保存；额度已用完')
    const host = new InferenceHost(deps)

    await expect(
      host.handle({
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: 'verify-notice',
        candidateKey: 'a'.repeat(64),
      }),
    ).resolves.toEqual({
      protocol: PROTOCOL_VERSION,
      type: 'result',
      requestId: 'verify-notice',
      ok: true,
      notice: '模型 Key 有效并已安全保存；额度已用完',
    })

    await expect(
      host.handle({
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: 'verify-plain',
        candidateKey: 'a'.repeat(64),
      }),
    ).resolves.toEqual({ protocol: PROTOCOL_VERSION, type: 'result', requestId: 'verify-plain', ok: true })
  })

  it('never attaches a notice to clear-key', async () => {
    const deps = dependencies()
    const host = new InferenceHost(deps)

    await expect(
      host.handle({ protocol: PROTOCOL_VERSION, type: 'clear-key', requestId: 'clear-notice' }),
    ).resolves.toEqual({ protocol: PROTOCOL_VERSION, type: 'result', requestId: 'clear-notice', ok: true })
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

  it('lets a clear intent from another options page supersede a late verification without side effects', async () => {
    const deps = dependencies()
    let resolveDownload: (() => void) | undefined
    const sideEffects: string[] = []
    vi.mocked(deps.verifyKey!).mockImplementationOnce(async (_candidateKey, signal) => {
      await new Promise<void>((resolve) => {
        resolveDownload = resolve
      })
      if (signal.aborted) {
        throw new Error('模型 Key 验证已取消')
      }
      sideEffects.push('cache', 'session', 'key')
    })
    vi.mocked(deps.clearKey!).mockImplementationOnce(async () => {
      sideEffects.push('clear')
    })
    const host = new InferenceHost(deps)
    const staleVerification = host.handle({
      protocol: PROTOCOL_VERSION,
      type: 'verify-key',
      requestId: 'verify-stale',
      candidateKey: 'e'.repeat(64),
    })
    await vi.waitFor(() => expect(resolveDownload).toBeTypeOf('function'))

    const clear = host.handle({
      protocol: PROTOCOL_VERSION,
      type: 'clear-key',
      requestId: 'clear-newest',
    })
    resolveDownload?.()

    await expect(staleVerification).resolves.toMatchObject({ ok: false })
    await expect(clear).resolves.toMatchObject({ ok: true, requestId: 'clear-newest' })
    expect(sideEffects).toEqual(['clear'])
  })

  it('serializes replacement intents and commits only the newest late verification', async () => {
    const deps = dependencies()
    let resolveFirstDownload: (() => void) | undefined
    const committedKeys: string[] = []
    vi.mocked(deps.verifyKey!).mockImplementation(async (candidateKey, signal) => {
      if (candidateKey.startsWith('a')) {
        await new Promise<void>((resolve) => {
          resolveFirstDownload = resolve
        })
      }
      if (signal.aborted) {
        throw new Error('模型 Key 验证已取消')
      }
      committedKeys.push(candidateKey)
    })
    const host = new InferenceHost(deps)
    const first = host.handle({
      protocol: PROTOCOL_VERSION,
      type: 'verify-key',
      requestId: 'verify-first-page',
      candidateKey: 'a'.repeat(64),
    })
    await vi.waitFor(() => expect(resolveFirstDownload).toBeTypeOf('function'))
    const second = host.handle({
      protocol: PROTOCOL_VERSION,
      type: 'verify-key',
      requestId: 'verify-second-page',
      candidateKey: 'b'.repeat(64),
    })

    resolveFirstDownload?.()

    await expect(first).resolves.toMatchObject({ ok: false })
    await expect(second).resolves.toMatchObject({ ok: true, requestId: 'verify-second-page' })
    expect(committedKeys).toEqual(['b'.repeat(64)])
  })

  it('fails closed when the host has no Key clearer', async () => {
    const deps = dependencies()
    const host = new InferenceHost({ detector: deps.detector, verifyKey: deps.verifyKey! })

    await expect(
      host.handle({ protocol: PROTOCOL_VERSION, type: 'clear-key', requestId: 'clear-unsupported' }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining('不支持清除模型 Key') })
  })

  it('aborts an active Key intent when its caller disconnects', async () => {
    const deps = dependencies()
    let receivedSignal: AbortSignal | undefined
    vi.mocked(deps.verifyKey!).mockImplementationOnce(
      async (_candidateKey, signal) =>
        new Promise<string | undefined>((_resolve, reject) => {
          receivedSignal = signal
          signal.addEventListener('abort', () => reject(new Error('模型 Key 验证已取消')), { once: true })
        }),
    )
    const host = new InferenceHost(deps)
    const controller = new AbortController()
    const response = host.handle(
      {
        protocol: PROTOCOL_VERSION,
        type: 'verify-key',
        requestId: 'verify-disconnect',
        candidateKey: 'f'.repeat(64),
      },
      controller.signal,
    )
    await vi.waitFor(() => expect(receivedSignal).toBeInstanceOf(AbortSignal))

    controller.abort()

    expect(receivedSignal?.aborted).toBe(true)
    await expect(response).resolves.toMatchObject({ ok: false, requestId: 'verify-disconnect' })
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
