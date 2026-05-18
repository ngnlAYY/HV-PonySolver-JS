import { ANSWER_CODES } from '@hv-pony-solver/shared'
import { describe, expect, it } from 'vitest'

import { captchaSelectors } from '../../src/captcha/captcha-selectors'
import { solverConfig } from '../../src/captcha/solver-config'
import { timingConfig } from '../../src/captcha/timing-config'
import { inferenceConfig } from '../../src/inference/inference-config'
import { modelConfig } from '../../src/model/model-config'
import { randDelay, shuffle } from '../../src/utils/delay'
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
    expect(inferenceConfig.imageSize).toBe(640)
    expect(inferenceConfig.confidenceThreshold).toBe(0.30)
    expect(inferenceConfig.maxDetections).toBe(16)
    expect(inferenceConfig.maxKinds).toBe(3)
    expect(modelConfig.accessKey).toBe('')
    expect(modelConfig.urlBase).toBe('https://models.ngnl.host/yolo26n-640.onnx')
    expect(modelConfig.cacheName).toBe('pony-solver-local')
    expect(modelConfig.cacheKey).toBe('yolo26n-640.onnx')
    expect(modelConfig.version).toBe('yolo26n-640-2026-05-14')
    expect(inferenceConfig.ortScriptUrl).toBe('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.min.js')
    expect(inferenceConfig.ortWasmPath).toBe('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/')
    expect(inferenceConfig.workerRequestTimeoutMs).toBe(30000)
  })
})

describe('utility functions', () => {
  it('escapes HTML-sensitive characters', () => {
    expect(escapeHtml('<tag a="b">&')).toBe('&lt;tag a=&quot;b&quot;&gt;&amp;')
  })

  it('formats unknown errors the same way as the legacy script', () => {
    expect(formatErrorMessage('plain')).toBe('plain')
    expect(formatErrorMessage(undefined)).toBe('未知错误')
    expect(formatErrorMessage(new TypeError('bad'))).toBe('TypeError: bad')
    expect(formatErrorMessage({ name: 'CustomError' })).toBe('CustomError')
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
})
