import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appendCaptcha } from '../helpers/captcha-fixture'

const prepare = vi.fn(async () => ({} as Worker))
const detect = vi.fn()
const destroyDetector = vi.fn()
const getImageBlob = vi.fn()
const registerModelSettingsMenu = vi.fn()
const registerDebugSettingsMenu = vi.fn()
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

vi.mock('../../src/model/model-settings', () => ({
  registerModelSettingsMenu,
}))

vi.mock('../../src/status-panel/panel-settings', () => ({
  getPanelPosition: vi.fn(async () => ({ top: 150, left: 1240 })),
  getPanelPositionSync: vi.fn(() => ({ top: 150, left: 1240 })),
  registerPanelSettingsMenu: vi.fn(),
}))

vi.mock('../../src/userscript/debug-settings', () => ({
  isDebugEnabled: vi.fn(() => false),
  registerDebugSettingsMenu,
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
    detect.mockResolvedValue({ success: false, ponies: [], confidences: {}, detections: [] })
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

  it('registers model settings and debug settings menus during init', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()

    expect(registerModelSettingsMenu).toHaveBeenCalledWith(expect.any(Function))
    expect(registerDebugSettingsMenu).toHaveBeenCalledTimes(1)
  })

  it('does not register duplicate model settings menus when init is called twice', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    app.init()

    expect(registerModelSettingsMenu).toHaveBeenCalledTimes(1)
    expect(registerDebugSettingsMenu).toHaveBeenCalledTimes(1)
  })

  it('verifies and caches the model from the settings menu callback', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    const verify = registerModelSettingsMenu.mock.calls[0][0]
    await verify()

    expect(modelDownload).toHaveBeenCalledWith(undefined, true)
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
    detect.mockResolvedValueOnce({ success: true, ponies: ['TS'], confidences: { TS: 0.9 }, detections: [{ class_id: 0, confidence: 0.9 }] })
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
    detect.mockResolvedValueOnce({ success: true, ponies: ['TS'], confidences: { TS: 0.9 }, detections: [{ class_id: 0, confidence: 0.9 }] })
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

    expect(getImageBlob).toHaveBeenCalledWith(expect.stringContaining('/captcha.png'))
    expect(externalSubmit.click).not.toHaveBeenCalled()
  })

  it('marks the captcha solved by the solver when content changes during prepare', async () => {
    let resolvePrepare: (() => void) | undefined
    prepare.mockReturnValueOnce(new Promise<Worker>((resolve) => {
      resolvePrepare = () => resolve({} as Worker)
    }))
    detect.mockResolvedValueOnce({ success: true, ponies: ['TS'], confidences: { TS: 0.9 }, detections: [{ class_id: 0, confidence: 0.9 }] })
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

    expect(prepare).toHaveBeenCalledTimes(1)
  })
})
