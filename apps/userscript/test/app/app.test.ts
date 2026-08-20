import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appendCaptcha } from '../../../../test/support/captcha-fixture'

const prepare = vi.fn(async () => ({}) as Worker)
const detect = vi.fn()
const destroyDetector = vi.fn()
const getImageBlob = vi.fn()
const registerSettingsMenu = vi.fn()
const modelDownload = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
const modelPutCached = vi.fn(async () => undefined)
const modelClose = vi.fn()
const apps: Array<{ destroy: () => void }> = []

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

  it('does not prepare ONNX until a captcha is present', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()

    expect(prepare).not.toHaveBeenCalled()
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

  it('does not register duplicate settings menus when init is called twice', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    app.init()

    expect(registerSettingsMenu).toHaveBeenCalledTimes(1)
  })

  it('verifies and caches the model from the settings menu callback with the candidate key', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    const verify = registerSettingsMenu.mock.calls[0][0].onVerifyModelAccessKey
    await verify('candidate-key')

    expect(modelDownload).toHaveBeenCalledWith(undefined, true, 'candidate-key')
    expect(modelPutCached).toHaveBeenCalledWith(expect.any(ArrayBuffer), true)
  })

  it('keeps settings model key verification successful when caching the verified model fails', async () => {
    modelPutCached.mockRejectedValueOnce(new Error('cache failed'))
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    const verify = registerSettingsMenu.mock.calls[0][0].onVerifyModelAccessKey

    await expect(verify('settings-key')).resolves.toBeUndefined()
    expect(modelDownload).toHaveBeenCalledWith(undefined, true, 'settings-key')
    expect(modelPutCached).toHaveBeenCalledWith(expect.any(ArrayBuffer), true)
  })

  it('coalesces DOM mutations into one captcha scan', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    document.body.appendChild(document.createElement('div'))
    document.body.appendChild(document.createElement('span'))
    appendCaptcha()
    await Promise.resolve()
    await vi.runAllTimersAsync()

    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('waits for captcha content before marking it handled', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    const captcha = document.createElement('div')
    captcha.id = 'riddlemaster'
    document.body.appendChild(captcha)
    await Promise.resolve()
    await vi.runAllTimersAsync()

    expect(prepare).not.toHaveBeenCalled()

    const fullCaptcha = appendCaptcha()
    captcha.append(...Array.from(fullCaptcha.childNodes))
    fullCaptcha.remove()
    await Promise.resolve()
    await vi.runAllTimersAsync()

    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('retries the same captcha after a failed solve', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    const captcha = appendCaptcha()
    await Promise.resolve()
    await vi.runAllTimersAsync()
    await Promise.resolve()

    captcha.appendChild(document.createElement('span'))
    await Promise.resolve()
    await vi.runAllTimersAsync()

    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('ignores unrelated DOM mutations when a captcha is already handled', async () => {
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

    app.init()
    appendCaptcha('/captcha.png')
    await Promise.resolve()
    await vi.runAllTimersAsync()
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
    await vi.runAllTimersAsync()

    document.body.appendChild(document.createElement('aside'))
    await Promise.resolve()
    await vi.runAllTimersAsync()

    expect(prepare).toHaveBeenCalledTimes(1)
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

  it('keeps a pending scan when captcha changes while solving is in flight', async () => {
    let resolveFirstDetect: (() => void) | undefined
    detect
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstDetect = () => resolve({
            success: true,
            ponies: ['TS'],
            confidences: { TS: 0.9 },
            detections: [{ class_id: 0, confidence: 0.9 }],
            candidates: [{ class_id: 0, confidence: 0.9 }],
          })
        }),
      )
      .mockResolvedValue({
        success: true,
        ponies: ['TS'],
        confidences: { TS: 0.9 },
        detections: [{ class_id: 0, confidence: 0.9 }],
        candidates: [{ class_id: 0, confidence: 0.9 }],
      })
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    const captcha = appendCaptcha('/captcha-a.png')
    await Promise.resolve()
    await vi.runAllTimersAsync()
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(1))

    captcha.querySelector('img')!.src = '/captcha-b.png'
    await Promise.resolve()
    await vi.runAllTimersAsync()
    resolveFirstDetect?.()
    await vi.runAllTimersAsync()

    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(2))
    expect(getImageBlob).toHaveBeenLastCalledWith(expect.stringContaining('/captcha-b.png'), expect.any(AbortSignal))
  })

  it('treats a same-URL captcha node replacement as a new target', async () => {
    let resolveFirstDetect: (() => void) | undefined
    detect
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstDetect = () =>
            resolve({
              success: true,
              ponies: ['TS'],
              confidences: { TS: 0.9 },
              detections: [{ class_id: 0, confidence: 0.9 }],
              candidates: [{ class_id: 0, confidence: 0.9 }],
            })
        }),
      )
      .mockResolvedValue({
        success: true,
        ponies: ['TS'],
        confidences: { TS: 0.9 },
        detections: [{ class_id: 0, confidence: 0.9 }],
        candidates: [{ class_id: 0, confidence: 0.9 }],
      })
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    const first = appendCaptcha('/captcha.png')
    first.submitButton.click = vi.fn()
    await Promise.resolve()
    await vi.runAllTimersAsync()
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(1))

    const replacement = appendCaptcha('/captcha.png')
    replacement.submitButton.click = vi.fn()
    first.replaceWith(replacement)
    await Promise.resolve()
    await vi.runAllTimersAsync()
    resolveFirstDetect?.()
    await vi.runAllTimersAsync()

    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(2))
    await vi.runAllTimersAsync()
    expect(first.submitButton.click).not.toHaveBeenCalled()
    expect(replacement.submitButton.click).toHaveBeenCalledTimes(1)
  })

  it('rescans captcha when the image src changes after a solved captcha', async () => {
    detect.mockResolvedValue({
      success: true,
      ponies: ['TS'],
      confidences: { TS: 0.9 },
      detections: [{ class_id: 0, confidence: 0.9 }],
      candidates: [{ class_id: 0, confidence: 0.9 }],
    })
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    const captcha = appendCaptcha('/captcha-a.png')
    await Promise.resolve()
    await vi.runAllTimersAsync()
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(1))
    await vi.runAllTimersAsync()
    await Promise.resolve()

    captcha.querySelector('img')!.src = '/captcha-b.png'
    await Promise.resolve()
    await vi.runAllTimersAsync()

    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(2))
    expect(getImageBlob).toHaveBeenLastCalledWith(expect.stringContaining('/captcha-b.png'), expect.any(AbortSignal))
  })

  it('abandons a stale target and solves the replacement when content changes during prepare', async () => {
    let resolvePrepare: (() => void) | undefined
    prepare.mockReturnValueOnce(
      new Promise<Worker>((resolve) => {
        resolvePrepare = () => resolve({} as Worker)
      }),
    )
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

    app.init()
    const captcha = appendCaptcha('/captcha-a.png')
    await Promise.resolve()
    await vi.runAllTimersAsync()
    captcha.querySelector('img')!.src = '/captcha-b.png'
    resolvePrepare?.()
    await vi.runAllTimersAsync()
    await Promise.resolve()

    captcha.appendChild(document.createElement('span'))
    await Promise.resolve()
    await vi.runAllTimersAsync()

    expect(prepare).toHaveBeenCalledTimes(2)
    expect(getImageBlob).toHaveBeenLastCalledWith(expect.stringContaining('/captcha-b.png'), expect.any(AbortSignal))
  })
})
