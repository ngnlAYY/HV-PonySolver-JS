import { ANSWER_CODES } from '@hv-pony-solver/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { captchaSelectors } from '../../src/captcha/captcha-selectors'
import { solverConfig } from '../../src/captcha/solver-config'
import { timingConfig } from '../../src/captcha/timing-config'
import {
  imagePreprocessConfig,
  inferenceRecoveryConfig,
  inferenceTimeoutConfig,
  prepareDeadlineConfig,
  yoloOutputConfig,
} from '../../src/inference/inference-config'
import { modelConfig } from '../../src/model/model-config'
import { ModelAccessKeyRejectedError } from '../../src/model/model-download-error'
import { randDelay, shuffle, sleep } from '../../src/utils/delay'
import { formatErrorMessage } from '../../src/utils/errors'
import { escapeHtml } from '../../src/utils/html'

describe('config defaults', () => {
  it('matches legacy DOM selectors', () => {
    expect(captchaSelectors.form).toBe('form[name="riddleform"]')
    expect(captchaSelectors.image).toBe('#riddleimage img')
    expect(captchaSelectors.master).toBe('#riddlemaster')
    expect(captchaSelectors.submit).toBe('#riddlesubmit')
    expect(captchaSelectors.answers).toBe('input[name="riddleanswer[]"]')
  })

  it('matches legacy config defaults', () => {
    expect(ANSWER_CODES).toEqual(['TS', 'RA', 'FS', 'RD', 'PP', 'AJ'])
    expect(timingConfig.submitDelay).toEqual([3000, 5000])
    expect(timingConfig.multiClickDelay).toEqual([1000, 1500])
    expect(solverConfig.randomOnFail).toBe(false)
    expect(imagePreprocessConfig.imageSize).toBe(640)
    expect(imagePreprocessConfig.maxEncodedBytes).toBe(2 * 1024 * 1024)
    expect(imagePreprocessConfig.maxSourceSide).toBe(4096)
    expect(imagePreprocessConfig.maxSourcePixels).toBe(16_000_000)
    expect(yoloOutputConfig.confidenceThreshold).toBe(0.3)
    expect(yoloOutputConfig.maxDetections).toBe(16)
    expect(yoloOutputConfig.maxKinds).toBe(3)
    expect(yoloOutputConfig.rowSize).toBe(6)
    expect(yoloOutputConfig.confidenceIndex).toBe(4)
    expect(yoloOutputConfig.classIndex).toBe(5)
    expect(yoloOutputConfig.maxOutputRows).toBe(100_000)
    expect(modelConfig.accessKey).toBe('')
    expect(modelConfig.urlBase).toBe('https://models.ngnl.host/yolo26n-640.ort')
    expect(modelConfig.cacheName).toBe('pony-solver-local')
    expect(modelConfig.cacheKey).toBe('yolo26n-640.ort')
    expect(modelConfig.version).toBe('yolo26n-640-2026-05-14')
    expect(modelConfig.verifyIntegrity).toBe(true)
    expect(inferenceTimeoutConfig.workerInitTimeoutMs).toBe(60000)
    expect(inferenceTimeoutConfig.workerDetectTimeoutMs).toBe(30000)
    expect(inferenceTimeoutConfig.workerAbortGraceTimeoutMs).toBe(1000)
    expect(inferenceTimeoutConfig.workerPrepareTimeoutMs).toBe(100000)
    expect(prepareDeadlineConfig).toEqual({
      workerTimeoutMs: 100_000,
      contentTimeoutMs: 105_000,
      brokerTimeoutMs: 110_000,
    })
    expect(prepareDeadlineConfig.workerTimeoutMs).toBeLessThan(prepareDeadlineConfig.contentTimeoutMs)
    expect(prepareDeadlineConfig.contentTimeoutMs).toBeLessThan(prepareDeadlineConfig.brokerTimeoutMs)
    expect(inferenceTimeoutConfig.modelDownloadTimeoutMs).toBe(30000)
    expect(inferenceTimeoutConfig.modelCacheTimeoutMs).toBe(5000)
    expect(inferenceRecoveryConfig.maxConsecutiveWorkerErrors).toBe(3)
  })
})

describe('browser-core utility functions', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('escapes HTML-sensitive characters', () => {
    expect(escapeHtml('<tag a="b">&')).toBe('&lt;tag a=&quot;b&quot;&gt;&amp;')
  })

  it('formats unknown errors the same way as the legacy script', () => {
    expect(formatErrorMessage('plain')).toBe('plain')
    expect(formatErrorMessage(undefined)).toBe('未知错误')
    expect(formatErrorMessage(new TypeError('bad'))).toBe('TypeError: bad')
    expect(formatErrorMessage({ name: 'CustomError' })).toBe('CustomError')
  })

  it('renders a carried userMessage verbatim instead of the class-name prefix', () => {
    expect(formatErrorMessage({ name: 'NoisyError', message: 'raw text', userMessage: '已经过翻译的文案' })).toBe(
      '已经过翻译的文案',
    )
    expect(formatErrorMessage({ name: 'NoisyError', message: 'raw text', userMessage: '' })).toBe(
      'NoisyError: raw text',
    )
    expect(formatErrorMessage(new ModelAccessKeyRejectedError())).toBe('模型 Key 无效或已失效，请在设置中重新验证 Key')
  })

  it('returns random delays inside the inclusive range', () => {
    for (let i = 0; i < 100; i += 1) {
      const value = randDelay([3, 5])
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThanOrEqual(5)
    }
  })

  it('shuffles without mutating or losing values', () => {
    const source = ['a', 'b', 'c', 'd']
    const result = shuffle(source)

    expect(source).toEqual(['a', 'b', 'c', 'd'])
    expect([...result].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('resolves an aborted sleep immediately without scheduling a timer', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()

    await sleep(1000, controller.signal)

    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its timer and abort listener when aborted during sleep', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener')
    const promise = sleep(1000, controller.signal)

    expect(vi.getTimerCount()).toBe(1)
    controller.abort()
    await promise

    expect(vi.getTimerCount()).toBe(0)
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
