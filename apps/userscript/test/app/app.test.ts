import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as BrowserCore from '@hv-pony-solver/browser-core'

import { appendCaptcha } from '../../../../test/support/captcha-fixture'

const prepare = vi.fn(async () => ({}) as Worker)
const detect = vi.fn()
const destroyDetector = vi.fn()
const getImageBlob = vi.fn()
const registerSettingsMenu = vi.fn()
const modelDownload = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
const modelPutCached = vi.fn(async () => undefined)
const modelClose = vi.fn()
const { probeModelAccessKey } = vi.hoisted(() => ({
  probeModelAccessKey: vi.fn<
    (
      signal?: AbortSignal,
      options?: { accessKeyOverride?: string },
    ) => Promise<{
      valid: boolean
      quotaExceededRetryAfterSeconds: number | null
    }>
  >(),
}))
const apps: Array<{ destroy: () => void }> = []

vi.mock('@hv-pony-solver/browser-core', async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserCore>()),
  probeModelAccessKey,
}))

vi.mock('../../src/inference/onnx-worker-client', () => ({
  OnnxWorkerClient: vi.fn(function OnnxWorkerClientMock() {
    return {
      prepare,
      destroy: destroyDetector,
      detect,
    }
  }),
}))

vi.mock('../../src/captcha/captcha-image-loader', () => ({
  CachedImageLoader: vi.fn(function CachedImageLoaderMock() {
    return {
      get: getImageBlob,
    }
  }),
}))

vi.mock('../../src/userscript/settings-menu', () => ({
  registerSettingsMenu,
}))

vi.mock('../../src/model/model-cache', () => ({
  ModelCache: vi.fn(function ModelCacheMock() {
    return {
      download: modelDownload,
      putCached: modelPutCached,
      close: modelClose,
    }
  }),
}))

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.clearAllMocks()
    getImageBlob.mockResolvedValue(new Blob())
    detect.mockResolvedValue({ success: false, ponies: [], confidences: {}, detections: [], candidates: [] })
    modelDownload.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
    modelPutCached.mockResolvedValue(undefined)
    probeModelAccessKey.mockResolvedValue({ valid: true, quotaExceededRetryAfterSeconds: null })
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => window.setTimeout(() => callback(0), 0)
    window.cancelAnimationFrame = (id: number): void => window.clearTimeout(id)
    apps.length = 0
    document.body.innerHTML = ''
  })

  afterEach(() => {
    for (const app of apps) {
      app.destroy()
    }
    apps.length = 0
  })

  it('registers the unified settings menu during init', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()

    expect(registerSettingsMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        onVerifyModelAccessKey: expect.any(Function),
      }),
    )
  })

  it('verifies the model access key through an unmetered HEAD probe without downloading', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    const verify = registerSettingsMenu.mock.calls[0][0].onVerifyModelAccessKey
    await verify('candidate-key')

    expect(probeModelAccessKey).toHaveBeenCalledWith(undefined, { accessKeyOverride: 'candidate-key' })
    expect(modelDownload).not.toHaveBeenCalled()
    expect(modelPutCached).not.toHaveBeenCalled()
  })

  it('rejects key verification when the HEAD probe reports an invalid key', async () => {
    probeModelAccessKey.mockResolvedValue({ valid: false, quotaExceededRetryAfterSeconds: null })
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    const verify = registerSettingsMenu.mock.calls[0][0].onVerifyModelAccessKey

    await expect(verify('rejected-key')).rejects.toThrow('模型 Key 无效或已失效，请在设置中重新验证 Key')
    expect(modelDownload).not.toHaveBeenCalled()
    expect(modelPutCached).not.toHaveBeenCalled()
  })

  it('does not solve forms outside the captcha container', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    const form = document.createElement('form')
    form.name = 'riddleform'
    const imageContainer = document.createElement('div')
    imageContainer.id = 'riddleimage'
    imageContainer.appendChild(document.createElement('img'))
    document.body.append(form, imageContainer)
    await Promise.resolve()
    await vi.runAllTimersAsync()

    expect(prepare).not.toHaveBeenCalled()
  })

  it('submits the form inside the captcha container when matching selectors exist outside it', async () => {
    detect.mockResolvedValueOnce({
      success: true,
      ponies: ['TS'],
      confidences: { TS: 0.9 },
      detections: [{ class_id: 0, confidence: 0.9 }],
      candidates: [{ class_id: 0, confidence: 0.9 }],
    })
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)
    const externalForm = document.createElement('form')
    externalForm.name = 'riddleform'
    for (let i = 0; i < 6; i += 1) {
      const answer = document.createElement('input')
      answer.name = 'riddleanswer[]'
      answer.type = 'checkbox'
      externalForm.appendChild(answer)
    }
    const externalSubmit = document.createElement('input')
    externalSubmit.id = 'riddlesubmit'
    externalSubmit.type = 'button'
    externalSubmit.click = vi.fn()
    externalForm.appendChild(externalSubmit)
    const externalImageContainer = document.createElement('div')
    externalImageContainer.id = 'riddleimage'
    const externalImage = document.createElement('img')
    externalImage.src = '/external.png'
    externalImageContainer.appendChild(externalImage)
    document.body.append(externalForm, externalImageContainer)

    app.init()
    appendCaptcha('/captcha.png')
    await Promise.resolve()
    await vi.runAllTimersAsync()
    expect(prepare).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(getImageBlob).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
    await vi.runAllTimersAsync()

    expect(getImageBlob).toHaveBeenCalledWith(expect.stringContaining('/captcha.png'), expect.any(AbortSignal))
    expect(externalSubmit.click).not.toHaveBeenCalled()
  })
})
