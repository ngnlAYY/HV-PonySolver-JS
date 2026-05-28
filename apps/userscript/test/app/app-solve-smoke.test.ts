import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnswerCode } from '@hv-pony-solver/shared'
import type { PanelStatus } from '../../src/status-panel/status-panel-types'

const prepare = vi.fn(async () => ({} as Worker))
const detect = vi.fn()
const destroyDetector = vi.fn()
const getImageBlob = vi.fn()
const registerModelSettingsMenu = vi.fn()
const modelDownload = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer)
const modelPutCached = vi.fn(async () => undefined)
const modelClose = vi.fn()
const apps: Array<{ destroy: () => void }> = []
const panelInstances: MockStatusPanel[] = []

type MockStatusPanel = Readonly<{
  setStatus: ReturnType<typeof vi.fn<(changes: Partial<PanelStatus>) => void>>
  setSessionReady: ReturnType<typeof vi.fn<(elapsed: number) => void>>
  addSuccess: ReturnType<typeof vi.fn<(ponies: AnswerCode[], confidences: Partial<Record<AnswerCode, number>>, elapsed: number) => void>>
  addRandomFailure: ReturnType<typeof vi.fn<(pony: AnswerCode, elapsed: number) => void>>
  addError: ReturnType<typeof vi.fn<(message: string, elapsed?: number) => void>>
  create: ReturnType<typeof vi.fn<() => void>>
  destroy: ReturnType<typeof vi.fn<() => void>>
}>

type CaptchaFixture = Readonly<{
  checkboxes: HTMLInputElement[]
  submitButton: HTMLInputElement & { click: ReturnType<typeof vi.fn<() => void>> }
}>

function appendCaptcha(src = '/captcha.png'): CaptchaFixture {
  const root = document.createElement('div')
  root.id = 'riddlemaster'

  const form = document.createElement('form')
  form.name = 'riddleform'
  const checkboxes = Array.from({ length: 6 }, () => {
    const answer = document.createElement('input')
    answer.name = 'riddleanswer[]'
    answer.type = 'checkbox'
    form.appendChild(answer)
    return answer
  })

  const submitButton = document.createElement('input') as HTMLInputElement & { click: ReturnType<typeof vi.fn<() => void>> }
  submitButton.id = 'riddlesubmit'
  submitButton.type = 'button'
  submitButton.click = vi.fn()
  form.appendChild(submitButton)

  const imageContainer = document.createElement('div')
  imageContainer.id = 'riddleimage'
  const image = document.createElement('img')
  image.src = src
  imageContainer.appendChild(image)

  root.append(form, imageContainer)
  document.body.appendChild(root)
  return { checkboxes, submitButton }
}

function createMockPanel(): MockStatusPanel {
  const panel = {
    setStatus: vi.fn<(changes: Partial<PanelStatus>) => void>(),
    setSessionReady: vi.fn<(elapsed: number) => void>(),
    addSuccess: vi.fn<(ponies: AnswerCode[], confidences: Partial<Record<AnswerCode, number>>, elapsed: number) => void>(),
    addRandomFailure: vi.fn<(pony: AnswerCode, elapsed: number) => void>(),
    addError: vi.fn<(message: string, elapsed?: number) => void>(),
    create: vi.fn<() => void>(),
    destroy: vi.fn<() => void>(),
  }
  panelInstances.push(panel)
  return panel
}

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

vi.mock('../../src/status-panel/status-panel', () => ({
  StatusPanel: vi.fn(function StatusPanelMock() {
    return createMockPanel()
  }),
}))

describe('App solve smoke', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.clearAllMocks()
    panelInstances.length = 0
    prepare.mockResolvedValue({} as Worker)
    getImageBlob.mockResolvedValue(new Blob(['captcha'], { type: 'image/png' }))
    detect.mockResolvedValue({ success: true, ponies: ['TS'], confidences: { TS: 0.91 }, detections: [], candidates: [] })
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
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('checks the detected pony, submits the form, and records success after init', async () => {
    let resolvePrepare: ((worker: Worker) => void) | undefined
    prepare.mockReturnValueOnce(new Promise<Worker>((resolve) => {
      resolvePrepare = resolve
    }))
    const { App } = await import('../../src/app/app')
    const captcha = appendCaptcha('/captcha.png')
    const app = new App()
    apps.push(app)

    app.init()
    await vi.advanceTimersByTimeAsync(100)
    await vi.runAllTimersAsync()

    expect(detect).not.toHaveBeenCalled()

    resolvePrepare?.({} as Worker)
    await vi.runAllTimersAsync()

    expect(getImageBlob).toHaveBeenCalledWith(expect.stringContaining('/captcha.png'))
    expect(detect).toHaveBeenCalledTimes(1)
    expect(captcha.checkboxes[0]?.checked).toBe(true)
    expect(captcha.checkboxes.slice(1).every((checkbox) => !checkbox.checked)).toBe(true)
    expect(captcha.submitButton.click).toHaveBeenCalledTimes(1)
    expect(panelInstances[0]?.addSuccess).toHaveBeenCalledWith(['TS'], { TS: 0.91 }, expect.any(Number))
  })
})
