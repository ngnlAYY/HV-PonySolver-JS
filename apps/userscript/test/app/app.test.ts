import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prepare = vi.fn(async () => ({}) as Worker)
const detect = vi.fn()
const destroyDetector = vi.fn()
const getImageBlob = vi.fn()
const registerModelSettingsMenu = vi.fn()
const modelDownload = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
const modelPutCached = vi.fn(async () => undefined)
const modelClose = vi.fn()
const injectedPanelCreate = vi.fn()
const injectedPanelDestroy = vi.fn()
const injectedDetectorDestroy = vi.fn()
const injectedModelClose = vi.fn()
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

vi.mock('../../src/model/model-cache', () => ({
  ModelCache: vi.fn(function ModelCacheMock() {
    return {
      download: modelDownload,
      putCached: modelPutCached,
      close: modelClose,
    }
  }),
}))

type CaptchaFixture = HTMLDivElement & { submitButton: HTMLInputElement }

function appendCaptcha(src = '/captcha.png'): CaptchaFixture {
  const captcha = document.createElement('div')
  captcha.id = 'riddlemaster'
  const form = document.createElement('form')
  form.name = 'riddleform'
  for (let i = 0; i < 6; i += 1) {
    const answer = document.createElement('input')
    answer.name = 'riddleanswer[]'
    answer.type = 'checkbox'
    form.appendChild(answer)
  }
  const submit = document.createElement('input')
  submit.id = 'riddlesubmit'
  submit.type = 'button'
  form.appendChild(submit)
  const imageContainer = document.createElement('div')
  imageContainer.id = 'riddleimage'
  const image = document.createElement('img')
  image.src = src
  imageContainer.appendChild(image)
  captcha.append(form, imageContainer)
  document.body.appendChild(captcha)
  return Object.assign(captcha, { submitButton: submit })
}

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.clearAllMocks()
    getImageBlob.mockResolvedValue(new Blob())
    detect.mockResolvedValue({ success: false, ponies: [], confidences: {}, detections: [] })
    modelDownload.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
    modelPutCached.mockResolvedValue(undefined)
    injectedPanelCreate.mockClear()
    injectedPanelDestroy.mockClear()
    injectedDetectorDestroy.mockClear()
    injectedModelClose.mockClear()
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

  it('uses injected dependencies when provided', async () => {
    const { App } = await import('../../src/app/app')
    const dependencies = {
      panel: {
        create: injectedPanelCreate,
        destroy: injectedPanelDestroy,
        setStatus: vi.fn(),
        setSessionReady: vi.fn(),
        addSuccess: vi.fn(),
        addRandomFailure: vi.fn(),
        addError: vi.fn(),
      },
      modelCache: {
        download: modelDownload,
        putCached: modelPutCached,
        close: injectedModelClose,
      },
      detector: {
        prepare,
        destroy: injectedDetectorDestroy,
        detect,
      },
      solver: {
        get isBusy() {
          return false
        },
        trigger: vi.fn(async () => ({ solved: false, captchaKey: null })),
      },
    }
    const app = new App(dependencies as unknown as ConstructorParameters<typeof App>[0])
    apps.push(app)

    app.init()
    app.destroy()

    expect(injectedPanelCreate).toHaveBeenCalledTimes(1)
    expect(injectedDetectorDestroy).toHaveBeenCalledTimes(1)
    expect(injectedModelClose).toHaveBeenCalledTimes(1)
    expect(injectedPanelDestroy).toHaveBeenCalledTimes(1)
  })

  it('does not call solver.trigger after destroy', async () => {
    const { App } = await import('../../src/app/app')
    const solverTrigger = vi.fn(async () => ({ solved: false, captchaKey: null }))
    const dependencies = {
      panel: {
        create: injectedPanelCreate,
        destroy: injectedPanelDestroy,
        setStatus: vi.fn(),
        setSessionReady: vi.fn(),
        addSuccess: vi.fn(),
        addRandomFailure: vi.fn(),
        addError: vi.fn(),
      },
      modelCache: {
        download: modelDownload,
        putCached: modelPutCached,
        close: injectedModelClose,
      },
      detector: {
        prepare,
        destroy: injectedDetectorDestroy,
        detect,
      },
      solver: {
        get isBusy() {
          return false
        },
        trigger: solverTrigger,
      },
    }
    const app = new App(dependencies as unknown as ConstructorParameters<typeof App>[0])
    apps.push(app)

    app.init()
    appendCaptcha()
    await Promise.resolve()
    // destroy 之前 prepare 还未完成时销毁
    app.destroy()
    await vi.runAllTimersAsync()
    await Promise.resolve()

    // destroy 之后 solver.trigger 不应被调用
    expect(solverTrigger).not.toHaveBeenCalled()
    apps.length = 0
  })

  it('registers model settings menu during init', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()

    expect(registerModelSettingsMenu).toHaveBeenCalledWith(expect.any(Function))
  })

  it('does not register duplicate model settings menus when init is called twice', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    app.init()

    expect(registerModelSettingsMenu).toHaveBeenCalledTimes(1)
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

  it('scans captcha mutations when animation frames are paused', async () => {
    window.requestAnimationFrame = vi.fn(() => 1)
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
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

  it('does not schedule a scan for unrelated DOM mutations', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    // 在没有 #riddlemaster 的情况下插入无关节点
    document.body.appendChild(document.createElement('span'))
    await Promise.resolve()
    await vi.runAllTimersAsync()
    await Promise.resolve()

    expect(prepare).not.toHaveBeenCalled()
  })

  it('throttles multiple related mutations into a single scheduleSolve call', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    // 插入 #riddlemaster 容器（触发第一个相关变更，启动 100ms timer）
    const captcha = appendCaptcha()
    await Promise.resolve()
    // 在 timer 到期前再触发两次相关变更（timer 已存在，被忽略）
    captcha.appendChild(document.createElement('span'))
    await Promise.resolve()
    captcha.appendChild(document.createElement('span'))
    await Promise.resolve()
    // 推进 timer，触发一次 scheduleSolve
    await vi.runAllTimersAsync()
    await Promise.resolve()

    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('clears the observer timer on destroy so scheduleSolve is never called', async () => {
    const { App } = await import('../../src/app/app')
    const app = new App()
    apps.push(app)

    app.init()
    // 触发相关变更，此时 100ms timer 已启动但尚未到期
    appendCaptcha()
    await Promise.resolve()
    // 立即 destroy，应清除 timer
    app.destroy()
    // 等待足够长时间确认 timer 不会再触发
    await vi.runAllTimersAsync()
    await Promise.resolve()

    expect(prepare).not.toHaveBeenCalled()
    // 防止 afterEach 重复 destroy
    apps.length = 0
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

    expect(getImageBlob).toHaveBeenCalledWith(expect.stringContaining('/captcha.png'))
    expect(externalSubmit.click).not.toHaveBeenCalled()
  })

  it('marks the captcha solved by the solver when content changes during prepare', async () => {
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

    expect(prepare).toHaveBeenCalledTimes(1)
  })
})
